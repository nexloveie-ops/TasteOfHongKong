import { Router, Request, Response, NextFunction } from 'express';
import { Checkout } from '../models/Checkout';
import { Order } from '../models/Order';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { createAppError } from '../middleware/errorHandler';

const router = Router();

// GET /api/reports/orders — Order history query (requires auth + report:view)
router.get('/orders', authMiddleware, requirePermission('report:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, type } = req.query;

    const filter: Record<string, unknown> = {
      status: { $in: ['checked_out', 'completed'] },
    };

    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) {
        dateFilter.$gte = new Date((startDate as string) + 'T00:00:00.000');
      }
      if (endDate) {
        dateFilter.$lte = new Date((endDate as string) + 'T23:59:59.999');
      }
      filter.createdAt = dateFilter;
    }

    if (type && ['dine_in', 'takeout'].includes(type as string)) {
      filter.type = type;
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();

    // Attach checkout info to each order
    const orderIds = orders.map(o => o._id);
    const checkouts = await Checkout.find({ orderIds: { $in: orderIds } }).lean();

    const orderCheckoutMap = new Map<string, typeof checkouts[0]>();
    for (const c of checkouts) {
      for (const oid of c.orderIds) {
        orderCheckoutMap.set(oid.toString(), c);
      }
    }

    const result = orders.map(order => {
      const checkout = orderCheckoutMap.get(order._id.toString());
      return {
        ...order,
        checkout: checkout ? {
          totalAmount: checkout.totalAmount,
          paymentMethod: checkout.paymentMethod,
          cashAmount: checkout.cashAmount,
          cardAmount: checkout.cardAmount,
          checkedOutAt: checkout.checkedOutAt,
        } : null,
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/summary — Revenue summary (requires auth + report:view)
router.get('/summary', authMiddleware, requirePermission('report:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query;

    const filter: Record<string, unknown> = {};

    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) {
        dateFilter.$gte = new Date((startDate as string) + 'T00:00:00.000');
      }
      if (endDate) {
        dateFilter.$lte = new Date((endDate as string) + 'T23:59:59.999');
      }
      filter.checkedOutAt = dateFilter;
    }

    const checkouts = await Checkout.find(filter).lean();

    let totalRevenue = 0;
    let cashTotal = 0;
    let cardTotal = 0;
    let mixedTotal = 0;

    for (const c of checkouts) {
      totalRevenue += c.totalAmount;
      if (c.paymentMethod === 'cash') {
        cashTotal += c.totalAmount;
      } else if (c.paymentMethod === 'card') {
        cardTotal += c.totalAmount;
      } else if (c.paymentMethod === 'mixed') {
        mixedTotal += c.totalAmount;
      }
    }

    res.json({
      totalRevenue,
      orderCount: checkouts.length,
      cashTotal,
      cardTotal,
      mixedTotal,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
