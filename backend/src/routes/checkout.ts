import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Server as SocketIOServer } from 'socket.io';
import { getModels } from '../getModels';
import { createAppError } from '../middleware/errorHandler';
import { optionalAuthMiddleware } from '../middleware/auth';
import { hasPermission } from '../middleware/permissions';
import { storeIoRoom } from '../socketRooms';
import { computeOrderPayableTotalEuro } from '../utils/orderPayableTotal';
import { resolveMemberPaymentForCheckout } from '../utils/checkoutMemberResolve';
import { creditMemberWallet, debitMemberWallet } from '../utils/memberWalletOps';
import { computeRefundChannelBreakdown } from '../utils/memberRefundAlign';
import { FeatureKeys, resolveStoreEffectiveFeatures } from '../utils/featureCatalog';

function staffMayDebitMemberWithoutPin(req: Request): boolean {
  const u = req.user;
  if (!u) return false;
  return hasPermission(u.role, 'checkout:process');
}

function round2Euro(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 重印小票 / 搜索：不展示 status 含 hide 的订单（与营业报表一致） */
function statusContainsHide(status: unknown): boolean {
  return String(status ?? '').toLowerCase().includes('hide');
}

/** 任一侧订单为 hide 则整笔结账不展示（避免一单多订单时仍出现 hide 金额） */
function checkoutTouchesHiddenOrder(
  c: Record<string, unknown>,
  orderById: Map<string, { status?: unknown }>,
): boolean {
  for (const oid of (c.orderIds || []) as mongoose.Types.ObjectId[]) {
    const o = orderById.get(oid.toString());
    if (o && statusContainsHide(o.status)) return true;
  }
  return false;
}

async function assertMemberWalletFeatureIfNeeded(req: Request): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const pm = String(body.paymentMethod || '');
  const hasMemberPhone = body.memberPhone != null && String(body.memberPhone).trim() !== '';
  if (!hasMemberPhone && pm !== 'member') return;
  const features = await resolveStoreEffectiveFeatures(req.storeId!);
  if (!features.has(FeatureKeys.CashierMemberWallet)) {
    throw createAppError('FORBIDDEN', `当前套餐未开通能力：${FeatureKeys.CashierMemberWallet}`);
  }
}

/** LZFoodModels uses Model<unknown>; narrow for route logic */
function checkoutModels() {
  return getModels() as {
    Order: mongoose.Model<any>;
    Checkout: mongoose.Model<any>;
    Member: mongoose.Model<any>;
    MemberWalletTxn: mongoose.Model<any>;
  };
}

export function createCheckoutRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /api/checkout/table/:tableNumber — Whole table checkout
  router.post('/table/:tableNumber', optionalAuthMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order, Checkout, Member, MemberWalletTxn } = checkoutModels();
      const tableNumber = parseInt(req.params.tableNumber as string, 10);
      if (isNaN(tableNumber)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid table number');
      }

      const { couponName, couponAmount } = req.body;

      // Find all pending dine-in orders for this table
      const orders = await Order.find({ storeId: req.storeId, type: 'dine_in', tableNumber, status: 'pending' });

      if (orders.length === 0) {
        throw createAppError('NOT_FOUND', 'No pending orders found for this table');
      }

      // Calculate total amount including bundle discounts
      const itemsTotal = orders.reduce((sum, order) => {
        return sum + order.items.reduce((itemSum: number, item: { unitPrice: number; quantity: number; selectedOptions?: { extraPrice?: number }[] }) => {
          const optExtra = (item.selectedOptions || []).reduce((s: number, o: { extraPrice?: number }) => s + (o.extraPrice || 0), 0);
          return itemSum + (item.unitPrice + optExtra) * item.quantity;
        }, 0);
      }, 0);
      const tableBundleDiscount = orders.reduce((sum, order) => {
        return sum + ((order as unknown as { appliedBundles?: { discount: number }[] }).appliedBundles || [])
          .reduce((s: number, b: { discount: number }) => s + b.discount, 0);
      }, 0);
      const totalAmount = itemsTotal - tableBundleDiscount;

      // Apply coupon discount
      let finalAmount = totalAmount;
      if (couponAmount && couponAmount > 0) {
        finalAmount = Math.max(0, totalAmount - couponAmount);
      }

      await assertMemberWalletFeatureIfNeeded(req);
      const mp = await resolveMemberPaymentForCheckout({
        storeId: req.storeId!,
        Member,
        finalAmount,
        body: req.body as Record<string, unknown>,
        skipMemberPin: staffMayDebitMemberWithoutPin(req),
      });

      const checkoutData: Record<string, unknown> = {
        storeId: req.storeId,
        type: 'table',
        tableNumber,
        totalAmount: finalAmount,
        paymentMethod: mp.paymentMethod,
        orderIds: orders.map(o => o._id),
        memberCreditUsed: mp.memberCreditUsed,
      };
      if (mp.memberId) {
        checkoutData.memberId = mp.memberId;
        checkoutData.memberPhoneSnapshot = mp.memberPhoneSnapshot;
      }
      if (mp.paymentMethod === 'mixed') {
        checkoutData.cashAmount = mp.cashAmount;
        checkoutData.cardAmount = mp.cardAmount;
      } else if (mp.paymentMethod === 'cash') {
        checkoutData.cashAmount = mp.cashAmount;
      } else if (mp.paymentMethod === 'card' || mp.paymentMethod === 'online') {
        checkoutData.cardAmount = mp.cardAmount;
      }
      if (couponName) checkoutData.couponName = couponName;
      if (couponAmount && couponAmount > 0) checkoutData.couponAmount = couponAmount;

      const checkout = await Checkout.create(checkoutData);
      try {
        if (mp.memberCreditUsed > 0 && mp.memberId) {
          await debitMemberWallet({
            Member,
            MemberWalletTxn,
            storeId: req.storeId!,
            memberId: mp.memberId,
            amountEuro: mp.memberCreditUsed,
            checkoutId: checkout._id,
            note: '整桌结账储值抵扣',
          });
        }
      } catch (e) {
        await Checkout.deleteOne({ _id: checkout._id });
        throw e;
      }

      try {
        const orderSet: Record<string, unknown> = { status: 'checked_out' };
        if (mp.memberId) {
          orderSet.memberId = mp.memberId;
          orderSet.memberPhoneSnapshot = mp.memberPhoneSnapshot;
          orderSet.memberCreditUsed = 0;
        }
        await Order.updateMany(
          { storeId: req.storeId, _id: { $in: orders.map(o => o._id) } },
          { $set: orderSet },
        );
      } catch (e) {
        if (mp.memberCreditUsed > 0 && mp.memberId) {
          await creditMemberWallet({
            Member,
            MemberWalletTxn,
            storeId: req.storeId!,
            memberId: mp.memberId,
            amountEuro: mp.memberCreditUsed,
            type: 'reversal',
            checkoutId: checkout._id,
            note: '结账后更新订单失败，冲回储值',
          });
        }
        await Checkout.deleteOne({ _id: checkout._id });
        throw e;
      }

      for (const order of orders) {
        io.to(storeIoRoom(req.storeId!)).emit('order:checked-out', { orderId: order._id.toString(), tableNumber });
      }

      res.status(201).json(checkout);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/checkout/seat/:orderId — Per-seat checkout
  router.post('/seat/:orderId', optionalAuthMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order, Checkout, Member, MemberWalletTxn } = checkoutModels();
      const orderId = req.params.orderId as string;
      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid order ID');
      }

      const { totalAmountOverride, couponName, couponAmount } = req.body;

      const order = await Order.findOne({ _id: orderId, storeId: req.storeId });
      if (!order) {
        throw createAppError('NOT_FOUND', 'Order not found');
      }

      if (order.status !== 'pending') {
        throw createAppError('VALIDATION_ERROR', 'Only pending orders can be checked out', {
          currentStatus: order.status,
        });
      }

      // Calculate total amount from items, apply bundle discounts, allow override
      const autoTotal = computeOrderPayableTotalEuro(order);
      const totalAmount = (totalAmountOverride != null && typeof totalAmountOverride === 'number' && totalAmountOverride >= 0)
        ? totalAmountOverride
        : autoTotal;

      // Apply coupon discount
      let finalAmount = totalAmount;
      if (couponAmount && couponAmount > 0) {
        finalAmount = Math.max(0, totalAmount - couponAmount);
      }

      await assertMemberWalletFeatureIfNeeded(req);
      const mp = await resolveMemberPaymentForCheckout({
        storeId: req.storeId!,
        Member,
        finalAmount,
        body: req.body as Record<string, unknown>,
        skipMemberPin: staffMayDebitMemberWithoutPin(req),
      });

      /**
       * 顾客扫码（外卖自提或堂食）+ 会员全额：与 Stripe 一致 — 先 paid_online、扣储值，不写 Checkout；
       * 由收银 complete-online-paid 再生成 Checkout 并 completed（堂食/自提待打印小票、厨房出单）。
       * 送餐顾客会员全额仍走下方（与 Stripe 送餐一致：当场 Checkout + checked_out）。
       */
      const isCustomerQrFullMemberPrepay =
        (order.type === 'takeout' || order.type === 'dine_in') &&
        !staffMayDebitMemberWithoutPin(req) &&
        mp.paymentMethod === 'member' &&
        mp.memberCreditUsed > 0.001;

      if (isCustomerQrFullMemberPrepay) {
        const walletNote =
          order.type === 'takeout'
            ? '外卖自提扫码储值支付（待收银收尾）'
            : '堂食扫码储值支付（待收银收尾）';
        try {
          await debitMemberWallet({
            Member,
            MemberWalletTxn,
            storeId: req.storeId!,
            memberId: mp.memberId!,
            amountEuro: mp.memberCreditUsed,
            orderId: new mongoose.Types.ObjectId(orderId),
            note: walletNote,
          });
        } catch (e) {
          throw e;
        }
        const prePaySet: Record<string, unknown> = {
          status: 'paid_online',
          memberId: mp.memberId,
          memberPhoneSnapshot: mp.memberPhoneSnapshot,
          memberCreditUsed: mp.memberCreditUsed,
        };
        try {
          await Order.findOneAndUpdate({ _id: orderId, storeId: req.storeId }, { $set: prePaySet });
        } catch (e) {
          await creditMemberWallet({
            Member,
            MemberWalletTxn,
            storeId: req.storeId!,
            memberId: mp.memberId!,
            amountEuro: mp.memberCreditUsed,
            type: 'reversal',
            orderId: new mongoose.Types.ObjectId(orderId),
            note: '更新订单失败，冲回储值',
          });
          throw e;
        }
        const updatedLean = await Order.findOne({ _id: orderId, storeId: req.storeId }).lean();
        io.to(storeIoRoom(req.storeId!)).emit('order:updated', updatedLean);
        res.status(201).json({
          ok: true,
          status: 'paid_online',
          orderId,
          memberPrepaidTakeout: order.type === 'takeout',
          memberPrepaidDineIn: order.type === 'dine_in',
        });
        return;
      }

      const checkoutData: Record<string, unknown> = {
        storeId: req.storeId,
        type: 'seat',
        totalAmount: finalAmount,
        paymentMethod: mp.paymentMethod,
        orderIds: [order._id],
        memberCreditUsed: mp.memberCreditUsed,
      };

      if (order.tableNumber != null) {
        checkoutData.tableNumber = order.tableNumber;
      }

      if (mp.memberId) {
        checkoutData.memberId = mp.memberId;
        checkoutData.memberPhoneSnapshot = mp.memberPhoneSnapshot;
      }
      if (mp.paymentMethod === 'mixed') {
        checkoutData.cashAmount = mp.cashAmount;
        checkoutData.cardAmount = mp.cardAmount;
      } else if (mp.paymentMethod === 'cash') {
        checkoutData.cashAmount = mp.cashAmount;
      } else if (mp.paymentMethod === 'card' || mp.paymentMethod === 'online') {
        checkoutData.cardAmount = mp.cardAmount;
      }
      if (couponName) checkoutData.couponName = couponName;
      if (couponAmount && couponAmount > 0) checkoutData.couponAmount = couponAmount;

      const checkout = await Checkout.create(checkoutData);
      try {
        if (mp.memberCreditUsed > 0 && mp.memberId) {
          await debitMemberWallet({
            Member,
            MemberWalletTxn,
            storeId: req.storeId!,
            memberId: mp.memberId,
            amountEuro: mp.memberCreditUsed,
            orderId: new mongoose.Types.ObjectId(orderId),
            checkoutId: checkout._id,
            note: '单笔结账储值抵扣',
          });
        }
      } catch (e) {
        await Checkout.deleteOne({ _id: checkout._id });
        throw e;
      }

      /** 与 Stripe 在线支付一致：QR 送餐预付款记为 checked_out，便于顾客端显示「已支付」与配送流程 */
      const orderSet: Record<string, unknown> = { status: 'checked_out' };
      if (mp.memberId) {
        orderSet.memberId = mp.memberId;
        orderSet.memberPhoneSnapshot = mp.memberPhoneSnapshot;
        orderSet.memberCreditUsed = mp.memberCreditUsed;
      }
      try {
        await Order.findOneAndUpdate(
          { _id: orderId, storeId: req.storeId },
          { $set: orderSet },
        );
      } catch (e) {
        if (mp.memberCreditUsed > 0 && mp.memberId) {
          await creditMemberWallet({
            Member,
            MemberWalletTxn,
            storeId: req.storeId!,
            memberId: mp.memberId,
            amountEuro: mp.memberCreditUsed,
            type: 'reversal',
            orderId: new mongoose.Types.ObjectId(orderId),
            checkoutId: checkout._id,
            note: '更新订单失败，冲回储值',
          });
        }
        await Checkout.deleteOne({ _id: checkout._id });
        throw e;
      }

      io.to(storeIoRoom(req.storeId!)).emit('order:checked-out', { orderId: order._id.toString(), tableNumber: order.tableNumber });

      res.status(201).json(checkout);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/checkout/receipt/:checkoutId — Get receipt data
  router.get('/receipt/:checkoutId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order, Checkout } = checkoutModels();
      const { checkoutId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(checkoutId as string)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid checkout ID');
      }

      const checkout = await Checkout.findOne({ _id: checkoutId, storeId: req.storeId }).lean() as {
        _id: mongoose.Types.ObjectId;
        orderIds: mongoose.Types.ObjectId[];
        type: string;
        tableNumber?: number;
        totalAmount: number;
        paymentMethod: string;
        cashAmount?: number;
        cardAmount?: number;
        checkedOutAt?: Date;
      } | null;
      if (!checkout) {
        throw createAppError('NOT_FOUND', 'Checkout not found');
      }

      // Populate orders with their items
      const orders = await Order.find({ storeId: req.storeId, _id: { $in: checkout.orderIds } }).lean();

      res.json({
        checkoutId: checkout._id,
        type: checkout.type,
        tableNumber: checkout.tableNumber,
        totalAmount: checkout.totalAmount,
        paymentMethod: checkout.paymentMethod,
        cashAmount: checkout.cashAmount,
        cardAmount: checkout.cardAmount,
        memberCreditUsed: (checkout as { memberCreditUsed?: number }).memberCreditUsed,
        memberPhoneSnapshot: (checkout as { memberPhoneSnapshot?: string }).memberPhoneSnapshot,
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
          customerName: (o as { customerName?: string }).customerName,
          customerPhone: (o as { customerPhone?: string }).customerPhone,
          deliveryAddress: (o as { deliveryAddress?: string }).deliveryAddress,
          postalCode: (o as { postalCode?: string }).postalCode,
          deliveryFeeEuro: (o as { deliveryFeeEuro?: number }).deliveryFeeEuro,
          deliveryDistanceKm: (o as { deliveryDistanceKm?: number }).deliveryDistanceKm,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/checkout/search?orderNumber=123456&date=2026-04-15
  // 无单号：当日 = Checkout.checkedOutAt 落在窗口内的真实小票，外加「从未写入 Checkout」的订单在当日的占位小票
  //（有 completedAt 则按完结日，否则按 createdAt；±14h 与单号搜索一致）。
  // 有单号：按外卖号 dailyOrderNumber / 堂食号 dineInOrderNumber 查找，不按 createdAt 卡日期（避免已付款却搜不到）。
  router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order, Checkout } = checkoutModels();
      const { orderNumber, date } = req.query;

      const rawDate = (date as string) || new Date().toISOString().slice(0, 10);
      const dateStr = String(rawDate).slice(0, 10);
      const parts = dateStr.split('-').map((x) => Number(x));
      const y = parts[0];
      const mo = parts[1];
      const d = parts[2];
      const padMs = 14 * 60 * 60 * 1000; // ±14h：缓和时区与「本地日历日」与 UTC 边界不一致导致的漏单
      const startOfDay =
        Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d)
          ? new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0) - padMs)
          : new Date(dateStr + 'T00:00:00.000Z');
      const endOfDay =
        Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d)
          ? new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999) + padMs)
          : new Date(dateStr + 'T23:59:59.999Z');

      const searchableOrderStatuses = [
        'checked_out',
        'completed',
        'refunded',
        'paid_online',
      ] as const;

      const mapCheckoutToResult = (c: Record<string, unknown>, orderDocs: Record<string, unknown>[]) => {
        const checkoutOrders = orderDocs.filter((o) =>
          (c.orderIds as mongoose.Types.ObjectId[]).some((cid) => cid.toString() === String(o._id)),
        );
        const allItems = checkoutOrders.flatMap((o) => (o.items as unknown[]) || []);
        const allRefunded =
          allItems.length > 0 &&
          allItems.every((i) => !!(i as { refunded?: boolean }).refunded);
        const hasRefund = allItems.some((i) => !!(i as { refunded?: boolean }).refunded);
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
          orders: checkoutOrders.map((o) => ({
            _id: o._id,
            type: o.type,
            tableNumber: o.tableNumber,
            seatNumber: o.seatNumber,
            dailyOrderNumber: o.dailyOrderNumber,
            dineInOrderNumber: o.dineInOrderNumber,
            status: o.status,
            customerName: o.customerName,
            customerPhone: o.customerPhone,
            deliveryAddress: o.deliveryAddress,
            postalCode: o.postalCode,
            deliveryFeeEuro: o.deliveryFeeEuro,
            deliveryDistanceKm: o.deliveryDistanceKm,
            appliedBundles: (o.appliedBundles as unknown[]) ?? [],
            items: o.items,
          })),
        };
      };

      type PayableOrderInput = Parameters<typeof computeOrderPayableTotalEuro>[0];
      const syntheticReceiptFromOrder = (o: Record<string, unknown>) => {
        const oItems = (o.items as unknown[]) || [];
        const allRefunded =
          oItems.length > 0 && oItems.every((i) => !!(i as { refunded?: boolean }).refunded);
        const hasRefund = oItems.some((i) => !!(i as { refunded?: boolean }).refunded);
        const ts = (o.completedAt || o.updatedAt || o.createdAt) as Date | string | undefined;
        const checkedOutAt = ts ? new Date(ts).toISOString() : new Date().toISOString();
        const orderSlice = {
          _id: o._id,
          type: o.type,
          tableNumber: o.tableNumber,
          seatNumber: o.seatNumber,
          dailyOrderNumber: o.dailyOrderNumber,
          dineInOrderNumber: o.dineInOrderNumber,
          status: o.status,
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          deliveryAddress: o.deliveryAddress,
          postalCode: o.postalCode,
          deliveryFeeEuro: o.deliveryFeeEuro,
          deliveryDistanceKm: o.deliveryDistanceKm,
          appliedBundles: (o.appliedBundles as unknown[]) ?? [],
          items: o.items,
        };
        const stripePiVirt = String((o as { stripePaymentIntentId?: string }).stripePaymentIntentId || '').trim();
        const memberUsedVirt = Number((o as { memberCreditUsed?: number }).memberCreditUsed) || 0;
        const virtPm =
          !stripePiVirt && memberUsedVirt > 0.001 ? 'member' : 'online';
        const phoneVirt = String((o as { memberPhoneSnapshot?: string }).memberPhoneSnapshot || '').trim();
        return {
          checkoutId: `virtual:${String(o._id)}`,
          type: 'seat',
          tableNumber: o.tableNumber,
          totalAmount: computeOrderPayableTotalEuro(o as PayableOrderInput),
          paymentMethod: virtPm,
          ...(virtPm === 'member'
            ? { memberCreditUsed: memberUsedVirt, memberPhoneSnapshot: phoneVirt }
            : {}),
          cashAmount: undefined,
          cardAmount: undefined,
          checkedOutAt,
          refunded: allRefunded,
          partialRefund: hasRefund && !allRefunded,
          orders: [orderSlice],
        };
      };

      let checkouts: Record<string, unknown>[];
      let orders: Record<string, unknown>[];

      const trimmedNum =
        orderNumber && String(orderNumber).trim()
          ? String(orderNumber).trim().replace(/^\#+/, '').trim()
          : '';

      if (trimmedNum) {
        const num = Number(trimmedNum);
        const numberOr: Record<string, unknown>[] = [{ dineInOrderNumber: trimmedNum }];
        if (Number.isFinite(num) && !Number.isNaN(num)) {
          numberOr.push({ dailyOrderNumber: num });
        }
        // 少数库里 dailyOrderNumber 以字符串等形式存储时，补一条原始条件
        numberOr.push({ dailyOrderNumber: trimmedNum });
        const orderFilter: Record<string, unknown> = {
          storeId: req.storeId,
          status: { $in: [...searchableOrderStatuses] },
          $or: numberOr,
        };
        orders = (await Order.find(orderFilter).sort({ createdAt: -1 }).lean()) as Record<string, unknown>[];
        orders = orders.filter((o) => !statusContainsHide(o.status));
        if (orders.length === 0) {
          res.json([]);
          return;
        }
        const orderIds = orders.map((o) => o._id);
        checkouts = (await Checkout.find({ storeId: req.storeId, orderIds: { $in: orderIds } })
          .sort({ checkedOutAt: -1 })
          .lean()) as Record<string, unknown>[];
        const allCoIds = new Set<string>();
        for (const c of checkouts) {
          for (const cid of (c.orderIds || []) as mongoose.Types.ObjectId[]) {
            allCoIds.add(cid.toString());
          }
        }
        const ordersForCheckoutFilter =
          allCoIds.size === 0
            ? []
            : ((await Order.find({
                storeId: req.storeId,
                _id: { $in: [...allCoIds].map((id) => new mongoose.Types.ObjectId(id)) },
              })
                .select({ status: 1 })
                .lean()) as Record<string, unknown>[]);
        const orderByIdNum = new Map(ordersForCheckoutFilter.map((o) => [String(o._id), o]));
        checkouts = checkouts.filter((c) => !checkoutTouchesHiddenOrder(c, orderByIdNum));
        const covered = new Set<string>();
        for (const c of checkouts) {
          for (const cid of c.orderIds as mongoose.Types.ObjectId[]) {
            covered.add(cid.toString());
          }
        }
        const fromCheckouts = checkouts.map((c) => mapCheckoutToResult(c, orders));
        const orphanOrders = orders.filter((o) => !covered.has(String(o._id)));
        const merged = [...fromCheckouts, ...orphanOrders.map(syntheticReceiptFromOrder)];
        merged.sort(
          (a, b) =>
            new Date(b.checkedOutAt as string | Date).getTime() -
            new Date(a.checkedOutAt as string | Date).getTime(),
        );
        res.json(merged);
        return;
      }

      checkouts = (await Checkout.find({
        storeId: req.storeId,
        checkedOutAt: { $gte: startOfDay, $lte: endOfDay },
      })
        .sort({ checkedOutAt: -1 })
        .lean()) as Record<string, unknown>[];

      const orderObjectIds: mongoose.Types.ObjectId[] = [];
      for (const c of checkouts) {
        for (const cid of c.orderIds as mongoose.Types.ObjectId[]) {
          orderObjectIds.push(cid);
        }
      }
      const ordersFromCheckouts =
        orderObjectIds.length === 0
          ? []
          : ((await Order.find({
              storeId: req.storeId,
              _id: { $in: orderObjectIds },
            }).lean()) as Record<string, unknown>[]);

      const orderByIdDay = new Map(ordersFromCheckouts.map((o) => [String(o._id), o]));
      const checkoutsVisible = checkouts.filter((c) => !checkoutTouchesHiddenOrder(c, orderByIdDay));
      const fromCheckouts = checkoutsVisible.map((c) => mapCheckoutToResult(c, ordersFromCheckouts));

      /** 任意 Checkout 已关联的订单不再生成虚拟小票，避免与真实结账重复 */
      const orderIdsInAnyCheckout = (await Checkout.distinct('orderIds', {
        storeId: req.storeId,
      })) as mongoose.Types.ObjectId[];

      const orphanDateWindow: Record<string, unknown> = {
        $or: [
          { completedAt: { $gte: startOfDay, $lte: endOfDay } },
          {
            $and: [
              { completedAt: null },
              { createdAt: { $gte: startOfDay, $lte: endOfDay } },
            ],
          },
        ],
      };

      const orphanOrders = (await Order.find({
        storeId: req.storeId,
        status: { $in: [...searchableOrderStatuses] },
        _id: { $nin: orderIdsInAnyCheckout },
        ...orphanDateWindow,
      })
        .sort({ createdAt: -1 })
        .lean()) as Record<string, unknown>[];
      const orphanOrdersVisible = orphanOrders.filter((o) => !statusContainsHide(o.status));

      const fromOrphansOnly = orphanOrdersVisible.map(syntheticReceiptFromOrder);
      const mergedDay = [...fromCheckouts, ...fromOrphansOnly];
      mergedDay.sort(
        (a, b) =>
          new Date(b.checkedOutAt as string | Date).getTime() -
          new Date(a.checkedOutAt as string | Date).getTime(),
      );
      res.json(mergedDay);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/checkout/:checkoutId/refund — Refund specific items from a checkout
  // Body: { itemIds: string[] } — array of order item _id values to refund
  // If itemIds is empty or not provided, refund ALL items (full refund)
  router.post('/:checkoutId/refund', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order, Checkout, Member, MemberWalletTxn } = checkoutModels();
      const { checkoutId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(checkoutId as string)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid checkout ID');
      }

      const { itemIds } = req.body as { itemIds?: string[] };

      const checkout = await Checkout.findOne({ _id: checkoutId, storeId: req.storeId });
      if (!checkout) {
        throw createAppError('NOT_FOUND', 'Checkout not found');
      }

      const orders = await Order.find({ storeId: req.storeId, _id: { $in: checkout.orderIds } });
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

      const refundedEuro = round2Euro(refundAmount);
      let memberWalletRefundEuro = 0;
      let memberWalletRefundError: string | null = null;

      const ch = checkout as mongoose.Document & {
        memberId?: mongoose.Types.ObjectId;
        memberCreditUsed?: number;
        memberCreditRefundedEuro?: number;
        totalAmount?: number;
      };
      const totalCharged = round2Euro(Number(ch.totalAmount) || 0);
      const memberUsed = round2Euro(Number(ch.memberCreditUsed) || 0);
      const alreadyBack = round2Euro(Number(ch.memberCreditRefundedEuro) || 0);
      const memberRemaining = Math.max(0, round2Euro(memberUsed - alreadyBack));

      if (ch.memberId && memberRemaining > 0.001 && totalCharged > 0.001 && refundedEuro > 0) {
        const rawReturn = round2Euro((refundedEuro / totalCharged) * memberUsed);
        memberWalletRefundEuro = Math.min(rawReturn, memberRemaining, refundedEuro);
        memberWalletRefundEuro = round2Euro(memberWalletRefundEuro);
        if (memberWalletRefundEuro > 0.001) {
          try {
            await creditMemberWallet({
              Member,
              MemberWalletTxn,
              storeId: req.storeId!,
              memberId: ch.memberId,
              amountEuro: memberWalletRefundEuro,
              type: 'refund_credit',
              checkoutId: new mongoose.Types.ObjectId(checkoutId as string),
              note: `订单退款退回储值（退款额 €${refundedEuro}）`,
            });
            ch.memberCreditRefundedEuro = round2Euro(alreadyBack + memberWalletRefundEuro);
            await ch.save();
          } catch (e) {
            memberWalletRefundError = e instanceof Error ? e.message : 'member wallet refund failed';
          }
        }
      }

      io.to(storeIoRoom(req.storeId!)).emit('order:refunded', {
        checkoutId,
        refundedItems: refundedItemDetails,
        refundAmount: refundedEuro,
        memberWalletRefundEuro,
      });

      const co = checkout as mongoose.Document & {
        paymentMethod?: string;
        cashAmount?: number;
        cardAmount?: number;
      };
      const refundChannelBreakdown = computeRefundChannelBreakdown({
        refundedAmount: refundedEuro,
        memberWalletRefundEuro,
        paymentMethod: String(co.paymentMethod || 'cash'),
        cashAmount: Number(co.cashAmount) || 0,
        cardAmount: Number(co.cardAmount) || 0,
      });

      res.json({
        message: 'Refund successful',
        checkoutId,
        refundedAmount: refundedEuro,
        refundedItems: refundedItemDetails,
        memberWalletRefundEuro,
        refundChannelBreakdown,
        ...(memberWalletRefundError ? { memberWalletRefundError } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
