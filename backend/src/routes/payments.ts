import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Server as SocketIOServer } from 'socket.io';
import { getModels } from '../getModels';
import { createAppError } from '../middleware/errorHandler';
import { createStripeClient, getStripePublishableResolved } from '../utils/stripeConfig';
import { storeIoRoom } from '../socketRooms';
import { computeOrderPayableTotalEuro } from '../utils/orderPayableTotal';

function paymentModels() {
  return getModels() as {
    Order: mongoose.Model<any>;
    Checkout: mongoose.Model<any>;
    MemberWalletTxn: mongoose.Model<any>;
  };
}

export function createPaymentsRouter(io: SocketIOServer): Router {
  const router = Router();

/**
 * POST /api/payments/create-intent
 */
router.post('/create-intent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Order } = paymentModels();
    const { orderId } = req.body;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      throw createAppError('VALIDATION_ERROR', 'Valid orderId is required');
    }

    const order = await Order.findOne({ _id: orderId, storeId: req.storeId });
    if (!order) throw createAppError('NOT_FOUND', 'Order not found');
    if (order.status !== 'pending') throw createAppError('VALIDATION_ERROR', 'Order is already checked out');

    const totalEuro = computeOrderPayableTotalEuro(order);
    const totalAmount = Math.round(totalEuro * 100);

    if (totalAmount <= 0) throw createAppError('VALIDATION_ERROR', 'Order total must be greater than 0');

    const stripe = await createStripeClient(req.storeId!);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: { orderId, orderType: order.type },
    });

    res.json({ clientSecret: paymentIntent.client_secret, amount: totalAmount / 100 });
  } catch (err: unknown) {
    next(err);
  }
});

/**
 * POST /api/payments/confirm
 */
router.post('/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Order } = paymentModels();
    const { orderId, paymentIntentId } = req.body;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      throw createAppError('VALIDATION_ERROR', 'Valid orderId is required');
    }

    const order = await Order.findOne({ _id: orderId, storeId: req.storeId });
    if (!order) throw createAppError('NOT_FOUND', 'Order not found');

    if (order.status !== 'pending') {
      res.json({ message: 'Order already processed' });
      return;
    }

    const stripe = await createStripeClient(req.storeId!);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      throw createAppError('VALIDATION_ERROR', 'Payment not completed');
    }

    const totalChargedEuro = paymentIntent.amount / 100;
    order.customerOnlinePaymentAt = new Date();
    order.stripePaymentIntentId = String(paymentIntentId);

    if (order.type === 'delivery') {
      const { Checkout } = paymentModels();
      const expectedTotal = computeOrderPayableTotalEuro(order);
      if (Math.abs(expectedTotal - totalChargedEuro) > 0.02) {
        throw createAppError('VALIDATION_ERROR', '实付金额与订单合计不一致，请核对后重试', {
          expectedTotal,
          charged: totalChargedEuro,
        });
      }
      await Checkout.create({
        storeId: req.storeId,
        type: 'seat',
        totalAmount: totalChargedEuro,
        paymentMethod: 'online',
        orderIds: [order._id],
        tableNumber: order.tableNumber,
      });
      order.status = 'checked_out';
    } else {
      // 堂食 / 外卖：保持 paid_online，由收银 finalize 生成 Checkout
      order.status = 'paid_online';
    }

    await order.save();

    io.to(storeIoRoom(req.storeId!)).emit('order:updated', order);

    res.json({ message: 'Payment confirmed', orderId: order._id, totalAmount: totalChargedEuro });
  } catch (err: unknown) {
    next(err);
  }
});

/**
 * GET /api/payments/config
 */
router.get('/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const publishableKey = await getStripePublishableResolved(req.storeId!);
    res.json({ publishableKey });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payments/finalize
 * Staff finalizes a paid_online order: creates checkout record, sets status to checked_out.
 * Body: { orderId: string }
 */
router.post('/finalize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Order, Checkout, MemberWalletTxn } = paymentModels();
    const { orderId } = req.body;
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      throw createAppError('VALIDATION_ERROR', 'Valid orderId is required');
    }

    const order = await Order.findOne({ _id: orderId, storeId: req.storeId });
    if (!order) throw createAppError('NOT_FOUND', 'Order not found');

    if (order.status !== 'paid_online') {
      throw createAppError('VALIDATION_ERROR', 'Order is not in paid_online status');
    }

    // Calculate total
    const itemTotal = order.items.reduce((sum: number, item: { unitPrice: number; quantity: number; selectedOptions?: { extraPrice?: number }[] }) => {
      const optExtra = (item.selectedOptions || []).reduce((s: number, o: { extraPrice?: number }) => s + (o.extraPrice || 0), 0);
      return sum + (item.unitPrice + optExtra) * item.quantity;
    }, 0);
    const bundleDiscount = ((order as unknown as { appliedBundles?: { discount: number }[] }).appliedBundles || [])
      .reduce((s: number, b: { discount: number }) => s + b.discount, 0);
    const totalAmount = Math.round((itemTotal - bundleDiscount) * 100) / 100;

    const stripePi = String((order as { stripePaymentIntentId?: string }).stripePaymentIntentId || '').trim();
    const memberUsed = Number((order as { memberCreditUsed?: number }).memberCreditUsed) || 0;
    const memberPrepaid = !stripePi && memberUsed > 0.001 && (order as { memberId?: unknown }).memberId;

    if (memberPrepaid && Math.abs(totalAmount - memberUsed) > 0.02) {
      throw createAppError('VALIDATION_ERROR', '订单金额与已扣储值不一致，请核对订单', {
        totalAmount,
        memberCreditUsed: memberUsed,
      });
    }

    const checkoutPayload: Record<string, unknown> = {
      storeId: req.storeId,
      type: 'seat',
      totalAmount,
      paymentMethod: memberPrepaid ? 'member' : 'online',
      orderIds: [order._id],
      tableNumber: order.tableNumber,
    };
    if (memberPrepaid) {
      checkoutPayload.memberId = (order as { memberId: mongoose.Types.ObjectId }).memberId;
      checkoutPayload.memberPhoneSnapshot = String((order as { memberPhoneSnapshot?: string }).memberPhoneSnapshot || '');
      checkoutPayload.memberCreditUsed = memberUsed;
    }

    const checkout = await Checkout.create(checkoutPayload);

    if (memberPrepaid) {
      await MemberWalletTxn.updateMany(
        {
          storeId: req.storeId,
          orderId: order._id,
          type: 'spend',
          $or: [{ checkoutId: { $exists: false } }, { checkoutId: null }],
        },
        { $set: { checkoutId: checkout._id } },
      );
    }

    order.status = 'checked_out';
    await order.save();

    res.json({ message: 'Order finalized', checkoutId: checkout._id, totalAmount });
  } catch (err: unknown) {
    next(err);
  }
});

  return router;
}

export default createPaymentsRouter;
