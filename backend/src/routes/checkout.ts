import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Server as SocketIOServer } from 'socket.io';
import { Order } from '../models/Order';
import { Checkout } from '../models/Checkout';
import { createAppError } from '../middleware/errorHandler';
import { SystemConfig } from '../models/SystemConfig';

export function createCheckoutRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /api/checkout/table/:tableNumber — Whole table checkout
  router.post('/table/:tableNumber', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tableNumber = parseInt(req.params.tableNumber as string, 10);
      if (isNaN(tableNumber)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid table number');
      }

      const { paymentMethod, cashAmount, cardAmount, couponName, couponAmount } = req.body;

      if (!paymentMethod || !['cash', 'card', 'mixed', 'online'].includes(paymentMethod)) {
        throw createAppError('VALIDATION_ERROR', 'paymentMethod must be "cash", "card", "mixed", or "online"');
      }

      // Find all pending dine-in orders for this table
      const orders = await Order.find({ type: 'dine_in', tableNumber, status: 'pending' });

      if (orders.length === 0) {
        throw createAppError('NOT_FOUND', 'No pending orders found for this table');
      }

      // Calculate total amount including bundle discounts
      const itemsTotal = orders.reduce((sum, order) => {
        return sum + order.items.reduce((itemSum, item) => {
          const optExtra = (item.selectedOptions || []).reduce((s: number, o: { extraPrice?: number }) => s + (o.extraPrice || 0), 0);
          return itemSum + (item.unitPrice + optExtra) * item.quantity;
        }, 0);
      }, 0);
      const tableBundleDiscount = orders.reduce((sum, order) => {
        return sum + ((order as unknown as { appliedBundles?: { discount: number }[] }).appliedBundles || [])
          .reduce((s: number, b: { discount: number }) => s + b.discount, 0);
      }, 0);
      const totalAmount = itemsTotal - tableBundleDiscount;

      // Validate mixed payment
      if (paymentMethod === 'mixed') {
        if (cashAmount == null || cardAmount == null) {
          throw createAppError('VALIDATION_ERROR', 'cashAmount and cardAmount are required for mixed payment');
        }
        const total = Number(cashAmount) + Number(cardAmount);
        if (Math.abs(total - totalAmount) > 0.001) {
          throw createAppError('PAYMENT_AMOUNT_MISMATCH', 'cashAmount + cardAmount must equal totalAmount', {
            expectedTotal: totalAmount,
            actualTotal: total,
          });
        }
      }

      // Apply coupon discount
      let finalAmount = totalAmount;
      if (couponAmount && couponAmount > 0) {
        finalAmount = Math.max(0, totalAmount - couponAmount);
      }

      // Create checkout record
      const checkoutData: Record<string, unknown> = {
        type: 'table',
        tableNumber,
        totalAmount: finalAmount,
        paymentMethod,
        orderIds: orders.map(o => o._id),
      };

      if (paymentMethod === 'mixed') {
        checkoutData.cashAmount = Number(cashAmount);
        checkoutData.cardAmount = Number(cardAmount);
      }
      if (couponName) checkoutData.couponName = couponName;
      if (couponAmount && couponAmount > 0) checkoutData.couponAmount = couponAmount;

      const checkout = await Checkout.create(checkoutData);

      // Update all orders to checked_out
      await Order.updateMany(
        { _id: { $in: orders.map(o => o._id) } },
        { status: 'checked_out' }
      );

      // Emit Socket.IO event for each order
      for (const order of orders) {
        io.emit('order:checked-out', { orderId: order._id.toString(), tableNumber });
      }

      res.status(201).json(checkout);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/checkout/seat/:orderId — Per-seat checkout
  router.post('/seat/:orderId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orderId = req.params.orderId as string;
      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid order ID');
      }

      const { paymentMethod, cashAmount, cardAmount, totalAmountOverride, couponName, couponAmount } = req.body;

      if (!paymentMethod || !['cash', 'card', 'mixed', 'online'].includes(paymentMethod)) {
        throw createAppError('VALIDATION_ERROR', 'paymentMethod must be "cash", "card", "mixed", or "online"');
      }

      const order = await Order.findById(orderId);
      if (!order) {
        throw createAppError('NOT_FOUND', 'Order not found');
      }

      if (order.status !== 'pending') {
        throw createAppError('VALIDATION_ERROR', 'Only pending orders can be checked out', {
          currentStatus: order.status,
        });
      }

      // Calculate total amount from items, apply bundle discounts, allow override
      const itemTotal = order.items.reduce((sum, item) => {
        const optExtra = (item.selectedOptions || []).reduce((s: number, o: { extraPrice?: number }) => s + (o.extraPrice || 0), 0);
        return sum + (item.unitPrice + optExtra) * item.quantity;
      }, 0);
      const bundleDiscount = ((order as unknown as { appliedBundles?: { discount: number }[] }).appliedBundles || [])
        .reduce((s: number, b: { discount: number }) => s + b.discount, 0);
      const autoTotal = itemTotal - bundleDiscount;
      const totalAmount = (totalAmountOverride != null && typeof totalAmountOverride === 'number' && totalAmountOverride >= 0)
        ? totalAmountOverride
        : autoTotal;

      // Apply coupon discount before validation
      let finalAmount = totalAmount;
      if (couponAmount && couponAmount > 0) {
        finalAmount = Math.max(0, totalAmount - couponAmount);
      }

      // Validate mixed payment
      if (paymentMethod === 'mixed') {
        if (cashAmount == null || cardAmount == null) {
          throw createAppError('VALIDATION_ERROR', 'cashAmount and cardAmount are required for mixed payment');
        }
        const total = Number(cashAmount) + Number(cardAmount);
        if (Math.abs(total - finalAmount) > 0.001) {
          throw createAppError('PAYMENT_AMOUNT_MISMATCH', 'cashAmount + cardAmount must equal totalAmount', {
            expectedTotal: finalAmount,
            actualTotal: total,
          });
        }
      }

      // Create checkout record
      const checkoutData: Record<string, unknown> = {
        type: 'seat',
        totalAmount: finalAmount,
        paymentMethod,
        orderIds: [order._id],
      };

      if (order.tableNumber != null) {
        checkoutData.tableNumber = order.tableNumber;
      }

      if (paymentMethod === 'mixed') {
        checkoutData.cashAmount = Number(cashAmount);
        checkoutData.cardAmount = Number(cardAmount);
      }
      if (couponName) checkoutData.couponName = couponName;
      if (couponAmount && couponAmount > 0) checkoutData.couponAmount = couponAmount;

      const checkout = await Checkout.create(checkoutData);

      // Update order status
      order.status = 'checked_out';
      await order.save();

      // Emit Socket.IO event
      io.emit('order:checked-out', { orderId: order._id.toString(), tableNumber: order.tableNumber });

      res.status(201).json(checkout);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/checkout/receipt/:checkoutId — Get receipt data
  router.get('/receipt/:checkoutId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { checkoutId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(checkoutId as string)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid checkout ID');
      }

      const checkout = await Checkout.findById(checkoutId).lean();
      if (!checkout) {
        throw createAppError('NOT_FOUND', 'Checkout not found');
      }

      // Populate orders with their items
      const orders = await Order.find({ _id: { $in: checkout.orderIds } }).lean();

      res.json({
        checkoutId: checkout._id,
        type: checkout.type,
        tableNumber: checkout.tableNumber,
        totalAmount: checkout.totalAmount,
        paymentMethod: checkout.paymentMethod,
        cashAmount: checkout.cashAmount,
        cardAmount: checkout.cardAmount,
        checkedOutAt: checkout.checkedOutAt,
        orders: orders.map(o => ({
          _id: o._id,
          type: o.type,
          tableNumber: o.tableNumber,
          seatNumber: o.seatNumber,
          dailyOrderNumber: o.dailyOrderNumber,
          dineInOrderNumber: (o as Record<string, unknown>).dineInOrderNumber,
          status: o.status,
          items: o.items,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/checkout/search?orderNumber=123456&date=2026-04-15
  // If orderNumber is empty, return all checkouts for the given date
  router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderNumber, date } = req.query;

      const dateStr = (date as string) || new Date().toISOString().slice(0, 10);
      const startOfDay = new Date(dateStr + 'T00:00:00.000');
      const endOfDay = new Date(dateStr + 'T23:59:59.999');

      let orderFilter: Record<string, unknown>;

      if (orderNumber && String(orderNumber).trim()) {
        // Search by order number
        const num = Number(orderNumber);
        orderFilter = {
          status: { $in: ['checked_out', 'completed', 'refunded'] },
          createdAt: { $gte: startOfDay, $lte: endOfDay },
          $or: [
            { dineInOrderNumber: String(orderNumber).trim() },
            ...(Number.isInteger(num) ? [{ dailyOrderNumber: num }] : []),
          ],
        };
      } else {
        // No order number: return all checked-out orders for the date
        orderFilter = {
          status: { $in: ['checked_out', 'completed', 'refunded'] },
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        };
      }

      const orders = await Order.find(orderFilter).sort({ createdAt: -1 }).lean();
      if (orders.length === 0) {
        res.json([]);
        return;
      }

      const orderIds = orders.map(o => o._id);
      const checkouts = await Checkout.find({ orderIds: { $in: orderIds } }).sort({ checkedOutAt: -1 }).lean();

      const results = checkouts.map(c => {
        const checkoutOrders = orders
          .filter(o => c.orderIds.some((cid: mongoose.Types.ObjectId) => cid.toString() === o._id.toString()));
        const allItems = checkoutOrders.flatMap(o => o.items);
        const allRefunded = allItems.length > 0 && allItems.every((i: { refunded?: boolean }) => i.refunded);
        const hasRefund = allItems.some((i: { refunded?: boolean }) => i.refunded);
        return {
          checkoutId: c._id,
          type: c.type,
          tableNumber: c.tableNumber,
          totalAmount: c.totalAmount,
          paymentMethod: c.paymentMethod,
          cashAmount: c.cashAmount,
          cardAmount: c.cardAmount,
          checkedOutAt: c.checkedOutAt,
          refunded: allRefunded,
          partialRefund: hasRefund && !allRefunded,
          orders: checkoutOrders.map(o => ({
            _id: o._id,
            type: o.type,
            tableNumber: o.tableNumber,
            seatNumber: o.seatNumber,
            dailyOrderNumber: o.dailyOrderNumber,
            dineInOrderNumber: (o as Record<string, unknown>).dineInOrderNumber,
            status: o.status,
            items: o.items,
          })),
        };
      });

      res.json(results);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/checkout/:checkoutId/refund — Refund specific items from a checkout
  // Body: { itemIds: string[] } — array of order item _id values to refund
  // If itemIds is empty or not provided, refund ALL items (full refund)
  router.post('/:checkoutId/refund', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { checkoutId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(checkoutId as string)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid checkout ID');
      }

      const { itemIds } = req.body as { itemIds?: string[] };

      const checkout = await Checkout.findById(checkoutId);
      if (!checkout) {
        throw createAppError('NOT_FOUND', 'Checkout not found');
      }

      const orders = await Order.find({ _id: { $in: checkout.orderIds } });
      if (orders.length === 0) {
        throw createAppError('NOT_FOUND', 'No orders found for this checkout');
      }

      // Collect all items across all orders
      const allItems = orders.flatMap(o => o.items);

      let refundAmount = 0;
      const refundedItemDetails: { itemId: string; itemName: string; quantity: number; unitPrice: number }[] = [];

      if (itemIds && itemIds.length > 0) {
        // Partial refund: mark specific items as refunded
        for (const order of orders) {
          for (const item of order.items) {
            if (itemIds.includes(item._id.toString()) && !item.refunded) {
              item.refunded = true;
              const optExtra = (item.selectedOptions || []).reduce((s: number, o: { extraPrice?: number }) => s + (o.extraPrice || 0), 0);
              refundAmount += (item.unitPrice + optExtra) * item.quantity;
              refundedItemDetails.push({
                itemId: item._id.toString(),
                itemName: item.itemName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
              });
            }
          }
          // Check if all items in this order are refunded
          const allRefunded = order.items.every((i: { refunded?: boolean }) => i.refunded);
          if (allRefunded) {
            order.status = 'refunded';
          }
          await order.save();
        }
      } else {
        // Full refund: mark all non-refunded items
        for (const order of orders) {
          for (const item of order.items) {
            if (!item.refunded) {
              item.refunded = true;
              const optExtra = (item.selectedOptions || []).reduce((s: number, o: { extraPrice?: number }) => s + (o.extraPrice || 0), 0);
              refundAmount += (item.unitPrice + optExtra) * item.quantity;
              refundedItemDetails.push({
                itemId: item._id.toString(),
                itemName: item.itemName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
              });
            }
          }
          order.status = 'refunded';
          await order.save();
        }
      }

      if (refundedItemDetails.length === 0) {
        throw createAppError('VALIDATION_ERROR', 'No items to refund (already refunded or invalid item IDs)');
      }

      // Emit Socket.IO event
      io.emit('order:refunded', {
        checkoutId,
        refundedItems: refundedItemDetails,
        refundAmount: Math.round(refundAmount * 100) / 100,
      });

      res.json({
        message: 'Refund successful',
        checkoutId,
        refundedAmount: Math.round(refundAmount * 100) / 100,
        refundedItems: refundedItemDetails,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
