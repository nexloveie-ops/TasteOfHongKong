import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Stripe from 'stripe';
import { Order } from '../models/Order';
import { Checkout } from '../models/Checkout';
import { createAppError } from '../middleware/errorHandler';

const router = Router();

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY || '');
}

/**
 * POST /api/payments/create-intent
 */
router.post('/create-intent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.body;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      throw createAppError('VALIDATION_ERROR', 'Valid orderId is required');
    }

    const order = await Order.findById(orderId);
    if (!order) throw createAppError('NOT_FOUND', 'Order not found');
    if (order.status !== 'pending') throw createAppError('VALIDATION_ERROR', 'Order is already checked out');

    const itemTotal = order.items.reduce((sum, item) => {
      const optExtra = (item.selectedOptions || []).reduce((s: number, o: { extraPrice?: number }) => s + (o.extraPrice || 0), 0);
      return sum + (item.unitPrice + optExtra) * item.quantity;
    }, 0);
    const bundleDiscount = ((order as unknown as { appliedBundles?: { discount: number }[] }).appliedBundles || [])
      .reduce((s: number, b: { discount: number }) => s + b.discount, 0);
    const totalAmount = Math.round((itemTotal - bundleDiscount) * 100);

    if (totalAmount <= 0) throw createAppError('VALIDATION_ERROR', 'Order total must be greater than 0');

    const stripe = getStripe();
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
    const { orderId, paymentIntentId } = req.body;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      throw createAppError('VALIDATION_ERROR', 'Valid orderId is required');
    }

    const order = await Order.findById(orderId);
    if (!order) throw createAppError('NOT_FOUND', 'Order not found');

    if (order.status !== 'pending') {
      res.json({ message: 'Order already processed' });
      return;
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      throw createAppError('VALIDATION_ERROR', 'Payment not completed');
    }

    // Set to paid_online — staff will print receipt and finalize
    order.status = 'paid_online';
    await order.save();

    const totalAmount = paymentIntent.amount / 100;

    res.json({ message: 'Payment confirmed', orderId: order._id, totalAmount });
  } catch (err: unknown) {
    next(err);
  }
});

/**
 * GET /api/payments/config
 */
router.get('/config', (_req: Request, res: Response) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' });
});

/**
 * POST /api/payments/finalize
 * Staff finalizes a paid_online order: creates checkout record, sets status to checked_out.
 * Body: { orderId: string }
 */
router.post('/finalize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.body;
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      throw createAppError('VALIDATION_ERROR', 'Valid orderId is required');
    }

    const order = await Order.findById(orderId);
    if (!order) throw createAppError('NOT_FOUND', 'Order not found');

    if (order.status !== 'paid_online') {
      throw createAppError('VALIDATION_ERROR', 'Order is not in paid_online status');
    }

    // Calculate total
    const itemTotal = order.items.reduce((sum, item) => {
      const optExtra = (item.selectedOptions || []).reduce((s: number, o: { extraPrice?: number }) => s + (o.extraPrice || 0), 0);
      return sum + (item.unitPrice + optExtra) * item.quantity;
    }, 0);
    const bundleDiscount = ((order as unknown as { appliedBundles?: { discount: number }[] }).appliedBundles || [])
      .reduce((s: number, b: { discount: number }) => s + b.discount, 0);
    const totalAmount = Math.round((itemTotal - bundleDiscount) * 100) / 100;

    // Create checkout record
    const checkout = await Checkout.create({
      type: 'seat',
      totalAmount,
      paymentMethod: 'online',
      orderIds: [order._id],
      tableNumber: order.tableNumber,
    });

    order.status = 'checked_out';
    await order.save();

    res.json({ message: 'Order finalized', checkoutId: checkout._id, totalAmount });
  } catch (err: unknown) {
    next(err);
  }
});

export default router;
