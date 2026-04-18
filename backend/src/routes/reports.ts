import { Router, Request, Response, NextFunction } from 'express';
import { Checkout } from '../models/Checkout';
import { Order } from '../models/Order';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { createAppError } from '../middleware/errorHandler';

const router = Router();

// GET /api/reports/orders — Order history query (requires auth + report:view)
router.get('/orders', authMiddleware, requirePermission('report:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, type, paymentMethod, source, status } = req.query;

    const filter: Record<string, unknown> = {};

    if (status === 'refunded') {
      // Find orders that have ANY refunded items (partial or full)
      filter.status = { $in: ['checked_out', 'completed', 'refunded'] };
      filter['items.refunded'] = true;
    } else {
      // Include refunded orders too so totals match the card (which counts all checkouts)
      filter.status = { $in: ['checked_out', 'completed', 'refunded'] };
    }

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

    // Source filter: scan (table>0 & seat>0) vs cashier (table=0 or seat=0)
    if (source === 'scan') {
      filter.tableNumber = { $gt: 0 };
      filter.seatNumber = { $gt: 0 };
    } else if (source === 'cashier') {
      filter.$or = [{ tableNumber: { $in: [0, null] } }, { seatNumber: { $in: [0, null] } }];
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

    let result = orders.map(order => {
      const checkout = orderCheckoutMap.get(order._id.toString());
      return {
        ...order,
        checkout: checkout ? {
          checkoutId: (checkout as unknown as { _id: { toString(): string } })._id.toString(),
          totalAmount: checkout.totalAmount,
          paymentMethod: checkout.paymentMethod,
          cashAmount: checkout.cashAmount,
          cardAmount: checkout.cardAmount,
          checkedOutAt: checkout.checkedOutAt,
        } : null,
      };
    });

    // Filter by payment method after joining with checkout
    if (paymentMethod && ['cash', 'card', 'mixed'].includes(paymentMethod as string)) {
      result = result.filter(r => r.checkout?.paymentMethod === paymentMethod);
    }

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

// GET /api/reports/detailed — Detailed stats with order breakdown and top items (requires auth + report:view)
router.get('/detailed', authMiddleware, requirePermission('report:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter: Record<string, Date> = {};
    if (startDate) {
      dateFilter.$gte = new Date((startDate as string) + 'T00:00:00.000');
    }
    if (endDate) {
      dateFilter.$lte = new Date((endDate as string) + 'T23:59:59.999');
    }

    // Fetch ALL orders in date range (including refunded)
    const orderFilter: Record<string, unknown> = {
      status: { $in: ['checked_out', 'completed', 'refunded'] },
    };
    if (startDate || endDate) {
      orderFilter.createdAt = dateFilter;
    }

    const allOrders = await Order.find(orderFilter).lean();

    // Attach checkout info
    const orderIds = allOrders.map(o => o._id);
    const checkouts = await Checkout.find({ orderIds: { $in: orderIds } }).lean();
    const orderCheckoutMap = new Map<string, typeof checkouts[0]>();
    for (const c of checkouts) {
      for (const oid of c.orderIds) {
        orderCheckoutMap.set(oid.toString(), c);
      }
    }

    // Calculate revenue from checkout amounts, then subtract refunded items
    let grossRevenue = 0;
    let cashTotal = 0;
    let cardTotal = 0;
    let mixedTotal = 0;
    const countedCheckoutIds = new Set<string>();

    for (const order of allOrders) {
      const checkout = orderCheckoutMap.get(order._id.toString());
      if (checkout) {
        const cid = (checkout as unknown as { _id: { toString(): string } })._id.toString();
        if (!countedCheckoutIds.has(cid)) {
          countedCheckoutIds.add(cid);
          grossRevenue += checkout.totalAmount;
          if (checkout.paymentMethod === 'cash') {
            cashTotal += checkout.totalAmount;
          } else if (checkout.paymentMethod === 'card') {
            cardTotal += checkout.totalAmount;
          } else if (checkout.paymentMethod === 'mixed') {
            mixedTotal += checkout.totalAmount;
          }
        }
      }
    }

    // Count refunded items and calculate refund amount per payment method
    let refundedCount = 0;
    let refundedAmount = 0;
    let cashRefund = 0;
    let cardRefund = 0;
    let mixedRefund = 0;
    for (const order of allOrders) {
      const checkout = orderCheckoutMap.get(order._id.toString());
      const pm = checkout?.paymentMethod;
      for (const item of order.items) {
        if ((item as unknown as { refunded?: boolean }).refunded) {
          refundedCount++;
          const optExtra = ((item.selectedOptions || []) as { extraPrice?: number }[]).reduce((s, o) => s + (o.extraPrice || 0), 0);
          const amt = (item.unitPrice + optExtra) * item.quantity;
          refundedAmount += amt;
          if (pm === 'cash') cashRefund += amt;
          else if (pm === 'card') cardRefund += amt;
          else if (pm === 'mixed') mixedRefund += amt;
        }
      }
    }

    // Net revenue = gross - refunded
    const totalRevenue = grossRevenue - refundedAmount;

    // Order counts (exclude fully refunded from main counts)
    const activeOrders = allOrders.filter(o => o.status !== 'refunded');
    let dineInCount = 0;
    let takeoutCount = 0;
    let dineInScanCount = 0;
    let dineInCashierCount = 0;

    for (const order of activeOrders) {
      if (order.type === 'dine_in') {
        dineInCount++;
        if ((order.tableNumber ?? 0) > 0 && (order.seatNumber ?? 0) > 0) {
          dineInScanCount++;
        } else {
          dineInCashierCount++;
        }
      } else if (order.type === 'takeout') {
        takeoutCount++;
      }
    }

    // Top items aggregation (only non-refunded items)
    const itemMap = new Map<string, { itemName: string; itemNameEn: string; quantity: number; revenue: number }>();

    for (const order of allOrders) {
      for (const item of order.items) {
        if ((item as unknown as { refunded?: boolean }).refunded) continue;
        const key = item.itemName;
        const optExtra = ((item.selectedOptions || []) as { extraPrice?: number }[]).reduce((s, o) => s + (o.extraPrice || 0), 0);
        const existing = itemMap.get(key);
        if (existing) {
          existing.quantity += item.quantity;
          existing.revenue += (item.unitPrice + optExtra) * item.quantity;
        } else {
          itemMap.set(key, {
            itemName: item.itemName,
            itemNameEn: item.itemNameEn || '',
            quantity: item.quantity,
            revenue: (item.unitPrice + optExtra) * item.quantity,
          });
        }
      }
    }

    const topItems = Array.from(itemMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 20)
      .map(item => ({
        ...item,
        revenue: Math.round(item.revenue * 100) / 100,
      }));

    res.json({
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      orderCount: activeOrders.length,
      cashTotal: Math.round((cashTotal - cashRefund) * 100) / 100,
      cardTotal: Math.round((cardTotal - cardRefund) * 100) / 100,
      mixedTotal: Math.round((mixedTotal - mixedRefund) * 100) / 100,
      dineInCount,
      takeoutCount,
      dineInScanCount,
      dineInCashierCount,
      takeoutScanCount: takeoutCount,
      takeoutCashierCount: takeoutCount,
      refundedCount,
      refundedAmount: Math.round(refundedAmount * 100) / 100,
      topItems,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
