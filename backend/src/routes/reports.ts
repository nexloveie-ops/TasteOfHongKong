import { Router, Request, Response, NextFunction } from 'express';
import { Checkout } from '../models/Checkout';
import { Order } from '../models/Order';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { createAppError } from '../middleware/errorHandler';
import { aggregateVatSalesByMonth } from '../utils/vatReportAggregation';
import { buildVatReportPdfBuffer } from '../utils/vatReportPdf';

const router = Router();

// GET /api/reports/orders — Order history query (requires auth + report:view)
router.get('/orders', authMiddleware, requirePermission('report:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, type, paymentMethod, source, status } = req.query;

    const filter: Record<string, unknown> = {};

    if (status === 'refunded') {
      // Find orders that have ANY refunded items (partial or full)
      filter.status = { $in: ['checked_out', 'completed', 'refunded', 'checked_out-hide', 'completed-hide'] };
      filter['items.refunded'] = true;
    } else {
      // Include refunded orders too so totals match the card (which counts all checkouts)
      filter.status = { $in: ['checked_out', 'completed', 'refunded', 'checked_out-hide', 'completed-hide'] };
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

    if (type && ['dine_in', 'takeout', 'phone'].includes(type as string)) {
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
          couponName: (checkout as unknown as { couponName?: string }).couponName,
          couponAmount: (checkout as unknown as { couponAmount?: number }).couponAmount,
        } : null,
      };
    });

    // Filter by payment method after joining with checkout
    if (paymentMethod && ['cash', 'card', 'mixed', 'online'].includes(paymentMethod as string)) {
      result = result.filter(r => r.checkout?.paymentMethod === paymentMethod);
    }

    // Filter by coupon usage
    if (req.query.hasCoupon === 'true') {
      result = result.filter(r => r.checkout && (r.checkout as unknown as { couponAmount?: number }).couponAmount && (r.checkout as unknown as { couponAmount: number }).couponAmount > 0);
    }

    // Filter by bundle usage
    if (req.query.hasBundle === 'true') {
      result = result.filter(r => {
        const bundles = (r as unknown as { appliedBundles?: unknown[] }).appliedBundles;
        return bundles && bundles.length > 0;
      });
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

    // Fetch ALL orders in date range (including refunded, excluding hidden)
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
    let cashCount = 0;
    let cardCount = 0;
    let mixedCount = 0;
    let onlineTotal = 0;
    let onlineCount = 0;
    let couponCount = 0;
    let couponTotalAmount = 0;
    let grossCashAmount = 0;
    let grossCardAmount = 0;
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
            cashCount++;
            grossCashAmount += checkout.totalAmount;
          } else if (checkout.paymentMethod === 'card') {
            cardTotal += checkout.totalAmount;
            cardCount++;
            grossCardAmount += checkout.totalAmount;
          } else if (checkout.paymentMethod === 'mixed') {
            mixedTotal += checkout.totalAmount;
            mixedCount++;
            // Also add mixed cash/card parts into cashTotal/cardTotal
            cashTotal += checkout.cashAmount || 0;
            cardTotal += checkout.cardAmount || 0;
            grossCashAmount += checkout.cashAmount || 0;
            grossCardAmount += checkout.cardAmount || 0;
          } else if (checkout.paymentMethod === 'online') {
            onlineTotal += checkout.totalAmount;
            onlineCount++;
          }
          // Count coupons
          if ((checkout as unknown as { couponAmount?: number }).couponAmount && (checkout as unknown as { couponAmount: number }).couponAmount > 0) {
            couponCount++;
            couponTotalAmount += (checkout as unknown as { couponAmount: number }).couponAmount;
          }
        }
      }
    }

    // Count bundle offers used
    let bundleOfferCount = 0;
    let bundleOfferDiscount = 0;
    const bundleOfferBreakdown: Record<string, { name: string; nameEn: string; count: number; discount: number }> = {};
    for (const order of allOrders) {
      const bundles = (order as unknown as { appliedBundles?: { offerId?: string; name: string; nameEn?: string; discount: number }[] }).appliedBundles || [];
      for (const b of bundles) {
        bundleOfferCount++;
        bundleOfferDiscount += b.discount;
        const key = b.name;
        if (!bundleOfferBreakdown[key]) bundleOfferBreakdown[key] = { name: b.name, nameEn: b.nameEn || '', count: 0, discount: 0 };
        bundleOfferBreakdown[key].count++;
        bundleOfferBreakdown[key].discount += b.discount;
      }
    }

    // Count refunded items and calculate refund amount per payment method
    let refundedCount = 0;
    let refundedAmount = 0;
    let cashRefund = 0;
    let cardRefund = 0;
    let mixedRefund = 0;
    let onlineRefund = 0;
    for (const order of allOrders) {
      const checkout = orderCheckoutMap.get(order._id.toString());
      const pm = checkout?.paymentMethod;
      const refundedItems = order.items.filter((item: { refunded?: boolean }) => (item as unknown as { refunded?: boolean }).refunded);
      if (refundedItems.length === 0) continue;

      refundedCount += refundedItems.length;

      // Calculate refund amount considering bundle discounts
      const allRefunded = order.items.length > 0 && order.items.every((item: { refunded?: boolean }) => (item as unknown as { refunded?: boolean }).refunded);
      let amt: number;

      if (allRefunded && checkout) {
        // Full refund: use actual checkout amount (already includes bundle discount)
        amt = checkout.totalAmount;
      } else {
        // Partial refund: calculate item prices and proportionally distribute bundle discount
        let refundedItemsTotal = 0;
        let allItemsTotal = 0;
        for (const item of order.items) {
          const optExtra = ((item.selectedOptions || []) as { extraPrice?: number }[]).reduce((s, o) => s + (o.extraPrice || 0), 0);
          const itemAmt = (item.unitPrice + optExtra) * item.quantity;
          allItemsTotal += itemAmt;
          if ((item as unknown as { refunded?: boolean }).refunded) {
            refundedItemsTotal += itemAmt;
          }
        }
        const bundleDisc = ((order as unknown as { appliedBundles?: { discount: number }[] }).appliedBundles || []).reduce((s: number, b: { discount: number }) => s + b.discount, 0);
        // Proportionally reduce refund by bundle discount ratio
        if (allItemsTotal > 0 && bundleDisc > 0) {
          amt = refundedItemsTotal * (1 - bundleDisc / allItemsTotal);
        } else {
          amt = refundedItemsTotal;
        }
      }

      refundedAmount += amt;
      if (pm === 'cash') cashRefund += amt;
      else if (pm === 'card') cardRefund += amt;
      else if (pm === 'mixed') {
        // Split mixed refund proportionally between cash and card
        const mixedTotal2 = checkout ? (checkout.totalAmount || 1) : 1;
        const cashRatio = checkout ? (checkout.cashAmount || 0) / mixedTotal2 : 0;
        const cardRatio = checkout ? (checkout.cardAmount || 0) / mixedTotal2 : 0;
        cashRefund += amt * cashRatio;
        cardRefund += amt * cardRatio;
        mixedRefund += amt;
      }
      else if (pm === 'online') onlineRefund += amt;
    }

    // Net revenue = gross - refunded
    const totalRevenue = grossRevenue - refundedAmount;

    // Order counts and revenue by type
    const activeOrders = allOrders.filter(o => o.status !== 'refunded');
    let dineInCount = 0;
    let takeoutCount = 0;
    let phoneCount = 0;
    let dineInScanCount = 0;
    let dineInCashierCount = 0;
    let dineInRevenue = 0;
    let takeoutRevenue = 0;
    let phoneRevenue = 0;

    for (const order of activeOrders) {
      const checkout = orderCheckoutMap.get(order._id.toString());
      const orderItemTotal = order.items.reduce((s: number, i: { unitPrice: number; quantity: number }) => s + i.unitPrice * i.quantity, 0);
      if (order.type === 'dine_in') {
        dineInCount++;
        dineInRevenue += checkout?.totalAmount ?? orderItemTotal;
        if ((order.tableNumber ?? 0) > 0 && (order.seatNumber ?? 0) > 0) {
          dineInScanCount++;
        } else {
          dineInCashierCount++;
        }
      } else if (order.type === 'takeout') {
        takeoutCount++;
        takeoutRevenue += checkout?.totalAmount ?? orderItemTotal;
      } else if (order.type === 'phone') {
        phoneCount++;
        phoneRevenue += checkout?.totalAmount ?? orderItemTotal;
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
      cashCount,
      cardCount,
      mixedCount,
      onlineTotal: Math.round((onlineTotal - onlineRefund) * 100) / 100,
      onlineCount,
      couponCount,
      couponTotalAmount: Math.round(couponTotalAmount * 100) / 100,
      bundleOfferCount,
      bundleOfferDiscount: Math.round(bundleOfferDiscount * 100) / 100,
      grossCashAmount: Math.round(grossCashAmount * 100) / 100,
      grossCardAmount: Math.round(grossCardAmount * 100) / 100,
      dineInCount,
      dineInRevenue: Math.round(dineInRevenue * 100) / 100,
      takeoutCount,
      takeoutRevenue: Math.round(takeoutRevenue * 100) / 100,
      phoneCount,
      phoneRevenue: Math.round(phoneRevenue * 100) / 100,
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

// GET /api/reports/vat-pdf?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD — VAT worksheet PDF (IE Food 13.5% / Drink 23%)
router.get('/vat-pdf', authMiddleware, requirePermission('report:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') {
      throw createAppError('VALIDATION_ERROR', 'startDate and endDate are required (YYYY-MM-DD)');
    }

    const { byMonth, storeInfo } = await aggregateVatSalesByMonth(startDate, endDate);
    const buf = await buildVatReportPdfBuffer(storeInfo, byMonth, `${startDate} - ${endDate}`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="vat-report-${startDate}_${endDate}.pdf"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/item-options?itemName=xxx&startDate=xxx&endDate=xxx
// Returns paid option stats for a specific menu item
router.get('/item-options', authMiddleware, requirePermission('report:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { itemName, startDate, endDate } = req.query;
    if (!itemName) throw createAppError('VALIDATION_ERROR', 'itemName is required');

    const filter: Record<string, unknown> = {
      status: { $in: ['checked_out', 'completed', 'refunded'] },
      'items.itemName': itemName,
    };
    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) dateFilter.$gte = new Date((startDate as string) + 'T00:00:00.000');
      if (endDate) dateFilter.$lte = new Date((endDate as string) + 'T23:59:59.999');
      filter.createdAt = dateFilter;
    }

    const orders = await Order.find(filter).lean();

    const optionStats: Record<string, { groupName: string; choiceName: string; extraPrice: number; count: number; revenue: number }> = {};
    let totalSold = 0;
    let withPaidOptions = 0;

    for (const order of orders) {
      for (const item of order.items) {
        if (item.itemName !== itemName) continue;
        if ((item as unknown as { refunded?: boolean }).refunded) continue;
        totalSold += item.quantity;
        let hasPaid = false;
        if (item.selectedOptions && item.selectedOptions.length > 0) {
          for (const opt of item.selectedOptions) {
            if (opt.extraPrice > 0) {
              hasPaid = true;
              const key = `${opt.groupName}|${opt.choiceName}|${opt.extraPrice}`;
              if (!optionStats[key]) optionStats[key] = { groupName: opt.groupName || '', choiceName: opt.choiceName || '', extraPrice: opt.extraPrice, count: 0, revenue: 0 };
              optionStats[key].count += item.quantity;
              optionStats[key].revenue += opt.extraPrice * item.quantity;
            }
          }
        }
        if (hasPaid) withPaidOptions += item.quantity;
      }
    }

    const options = Object.values(optionStats).sort((a, b) => b.revenue - a.revenue);
    const totalOptionRevenue = options.reduce((s, o) => s + o.revenue, 0);

    res.json({ itemName, totalSold, withPaidOptions, totalOptionRevenue, options });
  } catch (err) { next(err); }
});

export default router;
