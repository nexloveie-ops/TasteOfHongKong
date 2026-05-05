import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Server as SocketIOServer } from 'socket.io';
import { getModels } from '../getModels';
import { createAppError } from '../middleware/errorHandler';
import { getBusinessStatus } from '../utils/businessHours';
import { mergeTemplateOptionGroupsForItem, type MenuItemLike } from '../utils/optionGroupTemplateApply';
import type { LeanOptionGroup } from '../utils/optionGroups';
import { storeIoRoom } from '../socketRooms';

function orderModels() {
  return getModels() as {
    MenuItem: mongoose.Model<any>;
    Order: mongoose.Model<any>;
    DailyOrderCounter: mongoose.Model<any>;
  };
}

type MenuItemForOrder = MenuItemLike & {
  translations?: { locale: string; name: string }[];
  price: number;
  isSoldOut?: boolean;
};

export function createOrdersRouter(io: SocketIOServer): Router {
  const router = Router();

  type SelectedOptInput = { groupId: string; choiceId: string };

  async function snapshotSelectedOptionsFromMenuItem(
    storeId: mongoose.Types.ObjectId,
    menuItem: MenuItemForOrder,
    selectedOptions: SelectedOptInput[] | undefined,
  ): Promise<{ groupName: string; groupNameEn: string; choiceName: string; choiceNameEn: string; extraPrice: number }[]> {
    if (!selectedOptions || !Array.isArray(selectedOptions) || selectedOptions.length === 0) return [];

    const merged = await mergeTemplateOptionGroupsForItem(storeId, {
      _id: menuItem._id,
      categoryId: menuItem.categoryId,
      optionGroups: (menuItem.optionGroups || []) as unknown as LeanOptionGroup[],
    });

    const snapshots: { groupName: string; groupNameEn: string; choiceName: string; choiceNameEn: string; extraPrice: number }[] = [];
    for (const sel of selectedOptions) {
      if (!sel.groupId || !mongoose.Types.ObjectId.isValid(sel.groupId)) {
        throw createAppError('VALIDATION_ERROR', `Invalid groupId: ${sel.groupId}`);
      }
      if (!sel.choiceId || !mongoose.Types.ObjectId.isValid(sel.choiceId)) {
        throw createAppError('VALIDATION_ERROR', `Invalid choiceId: ${sel.choiceId}`);
      }

      const group = merged.find((g) => g._id && g._id.toString() === sel.groupId);
      if (!group) {
        throw createAppError('VALIDATION_ERROR', `Unknown option group: ${sel.groupId}`);
      }
      const choice = group.choices.find((c) => c._id && c._id.toString() === sel.choiceId);
      if (!choice) {
        throw createAppError('VALIDATION_ERROR', `Unknown option choice: ${sel.choiceId}`);
      }

      const groupName = group.translations.find((t) => t.locale === 'zh-CN')?.name || group.translations[0]?.name || '';
      const groupNameEn = group.translations.find((t) => t.locale === 'en-US')?.name || groupName;
      const choiceName = choice.translations.find((t) => t.locale === 'zh-CN')?.name || choice.translations[0]?.name || '';
      const choiceNameEn = choice.translations.find((t) => t.locale === 'en-US')?.name || choiceName;

      snapshots.push({
        groupName,
        groupNameEn,
        choiceName,
        choiceNameEn,
        extraPrice: typeof choice.extraPrice === 'number' ? choice.extraPrice : 0,
      });
    }

    return snapshots;
  }

  async function buildOrderItemsPayload(
    storeId: mongoose.Types.ObjectId,
    items: { menuItemId: string; quantity: number; selectedOptions?: SelectedOptInput[] }[],
    menuItemMap: Map<string, MenuItemForOrder>,
  ) {
    const orderItems: {
      menuItemId: string;
      quantity: number;
      unitPrice: number;
      itemName: string;
      itemNameEn: string;
      selectedOptions: { groupName: string; groupNameEn: string; choiceName: string; choiceNameEn: string; extraPrice: number }[];
    }[] = [];

    for (const item of items) {
      const menuItem = menuItemMap.get(item.menuItemId)!;
      const zhTrans = menuItem.translations?.find((t: { locale: string }) => t.locale === 'zh-CN');
      const enTrans = menuItem.translations?.find((t: { locale: string }) => t.locale === 'en-US');
      const itemName = zhTrans?.name || enTrans?.name || (menuItem.translations?.[0] as { name: string })?.name || 'Unknown';
      const itemNameEn = enTrans?.name || zhTrans?.name || itemName;
      const selectedOptions = await snapshotSelectedOptionsFromMenuItem(storeId, menuItem, item.selectedOptions);

      orderItems.push({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: menuItem.price,
        itemName,
        itemNameEn,
        selectedOptions,
      });
    }

    return orderItems;
  }

  // POST /api/orders — Create a new order
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { MenuItem, Order, DailyOrderCounter } = orderModels();
      const { type, tableNumber, seatNumber, items, appliedBundles } = req.body;

      // Customer self-order channels follow business hour restrictions.
      if (type === 'dine_in' || type === 'takeout') {
        const status = await getBusinessStatus(req.storeId!);
        if (!status.isOpen) {
          throw createAppError('VALIDATION_ERROR', 'Restaurant is currently closed', {
            businessStatus: status,
          });
        }
      }

      // Validate type
      if (!type || !['dine_in', 'takeout', 'phone'].includes(type)) {
        throw createAppError('VALIDATION_ERROR', 'type must be "dine_in", "takeout", or "phone"');
      }

      // For dine_in, require tableNumber and seatNumber
      if (type === 'dine_in') {
        if (tableNumber == null || typeof tableNumber !== 'number') {
          throw createAppError('VALIDATION_ERROR', 'tableNumber is required for dine_in orders');
        }
        if (seatNumber == null || typeof seatNumber !== 'number') {
          throw createAppError('VALIDATION_ERROR', 'seatNumber is required for dine_in orders');
        }
      }

      // Validate items array
      if (!Array.isArray(items) || items.length === 0) {
        throw createAppError('VALIDATION_ERROR', 'items must be a non-empty array');
      }

      for (const item of items) {
        if (!item.menuItemId || !mongoose.Types.ObjectId.isValid(item.menuItemId)) {
          throw createAppError('VALIDATION_ERROR', `Invalid menuItemId: ${item.menuItemId}`);
        }
        if (!item.quantity || typeof item.quantity !== 'number' || item.quantity < 1) {
          throw createAppError('VALIDATION_ERROR', 'Each item must have a quantity >= 1');
        }
      }

      // Fetch all referenced menu items
      const menuItemIds = items.map((i: { menuItemId: string }) => i.menuItemId);
      const menuItems = await MenuItem.find({ storeId: req.storeId, _id: { $in: menuItemIds } });

      // Check all items exist
      const foundIds = new Set(menuItems.map((m) => m._id.toString()));
      const missingIds = menuItemIds.filter((id: string) => !foundIds.has(id));
      if (missingIds.length > 0) {
        throw createAppError('VALIDATION_ERROR', `Menu items not found: ${missingIds.join(', ')}`);
      }

      // Check for sold out items
      const soldOutItems = menuItems.filter((m) => m.isSoldOut);
      if (soldOutItems.length > 0) {
        throw createAppError('ITEM_SOLD_OUT', 'Some items are sold out', {
          soldOutItemIds: soldOutItems.map((m) => m._id.toString()),
        });
      }

      // Build a lookup map for menu items
      const menuItemMap = new Map(menuItems.map((m) => [m._id.toString(), m as MenuItemForOrder]));

      // Build order items with price/name snapshots
      const orderItems = await buildOrderItemsPayload(req.storeId!, items, menuItemMap);
      const orderData: Record<string, unknown> = {
        storeId: req.storeId,
        type,
        status: 'pending',
        items: orderItems,
        appliedBundles: Array.isArray(appliedBundles) ? appliedBundles : [],
      };

      if (type === 'dine_in') {
        orderData.tableNumber = tableNumber;
        orderData.seatNumber = seatNumber;
        // Generate 6-digit order number: HHmmss
        const now = new Date();
        orderData.dineInOrderNumber =
          String(now.getHours()).padStart(2, '0') +
          String(now.getMinutes()).padStart(2, '0') +
          String(now.getSeconds()).padStart(2, '0');
      }

      if (type === 'takeout' || type === 'phone') {
        const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const counter = await DailyOrderCounter.findOneAndUpdate(
          { storeId: req.storeId, date: todayStr },
          { $inc: { currentNumber: 1 }, $setOnInsert: { storeId: req.storeId, date: todayStr } },
          { upsert: true, returnDocument: 'after' }
        );
        orderData.dailyOrderNumber = counter!.currentNumber;
      }

      const order = await Order.create(orderData);

      io.to(storeIoRoom(req.storeId!)).emit('order:new', order);

      res.status(201).json(order);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/dine-in — Get pending and paid_online dine-in orders
  router.get('/dine-in', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order } = orderModels();
      const orders = await Order.find({ storeId: req.storeId, type: 'dine_in', status: { $in: ['pending', 'paid_online'] } }).sort({ tableNumber: 1, seatNumber: 1 });
      res.json(orders);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/dine-in/active?table=X&seat=Y — Get active orders for a specific table/seat
  router.get('/dine-in/active', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { table, seat } = req.query;
      if (!table || !seat) {
        return res.json([]);
      }
      const { Order } = orderModels();
      const orders = await Order.find({
        storeId: req.storeId,
        type: 'dine_in',
        tableNumber: Number(table),
        seatNumber: Number(seat),
        status: { $in: ['pending', 'paid_online'] },
      }).sort({ createdAt: -1 });
      res.json(orders);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/takeout — Get pending (not checked out) takeout orders sorted by dailyOrderNumber ASC
  router.get('/takeout', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order } = orderModels();
      const orders = await Order.find({ storeId: req.storeId, type: 'takeout', status: { $in: ['pending', 'paid_online'] } }).sort({ dailyOrderNumber: 1 });
      res.json(orders);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/phone — Get pending phone orders sorted by dailyOrderNumber ASC
  router.get('/phone', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order } = orderModels();
      const orders = await Order.find({ storeId: req.storeId, type: 'phone', status: 'pending' }).sort({ dailyOrderNumber: 1 });
      res.json(orders);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/takeout/pending — Get checked_out (not completed) takeout orders
  router.get('/takeout/pending', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order } = orderModels();
      const orders = await Order.find({ storeId: req.storeId, type: 'takeout', status: 'checked_out' }).sort({ dailyOrderNumber: 1 });
      res.json(orders);
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/orders/takeout/:id/complete — Mark takeout order as completed
  router.put('/takeout/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order } = orderModels();
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid order ID');
      }

      const order = await Order.findOne({ _id: id, storeId: req.storeId });
      if (!order) {
        throw createAppError('NOT_FOUND', 'Order not found');
      }

      if (order.type !== 'takeout') {
        throw createAppError('VALIDATION_ERROR', 'Only takeout orders can be marked as completed via this endpoint');
      }

      if (order.status !== 'checked_out') {
        throw createAppError('VALIDATION_ERROR', 'Only checked_out takeout orders can be marked as completed', {
          currentStatus: order.status,
        });
      }

      const updated = await Order.findOneAndUpdate(
        { _id: id, storeId: req.storeId },
        { $set: { status: 'completed', completedAt: new Date() } },
        { new: true },
      );
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/:id — Get order details
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order } = orderModels();
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid order ID');
      }

      const order = await Order.findOne({ _id: id, storeId: req.storeId });
      if (!order) {
        throw createAppError('NOT_FOUND', 'Order not found');
      }

      res.json(order);
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/orders/:id/items — Modify order items
  router.put('/:id/items', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { MenuItem, Order } = orderModels();
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid order ID');
      }

      const order = await Order.findOne({ _id: id, storeId: req.storeId });
      if (!order) {
        throw createAppError('NOT_FOUND', 'Order not found');
      }

      // Only pending orders can be modified
      if (order.status !== 'pending') {
        throw createAppError('ORDER_NOT_MODIFIABLE', 'Order cannot be modified', {
          currentStatus: order.status,
        });
      }

      const { items } = req.body;

      // Validate items array
      if (!Array.isArray(items) || items.length === 0) {
        throw createAppError('VALIDATION_ERROR', 'items must be a non-empty array');
      }

      for (const item of items) {
        if (!item.menuItemId || !mongoose.Types.ObjectId.isValid(item.menuItemId)) {
          throw createAppError('VALIDATION_ERROR', `Invalid menuItemId: ${item.menuItemId}`);
        }
        if (!item.quantity || typeof item.quantity !== 'number' || item.quantity < 1) {
          throw createAppError('VALIDATION_ERROR', 'Each item must have a quantity >= 1');
        }
      }

      // Fetch all referenced menu items
      const menuItemIds = items.map((i: { menuItemId: string }) => i.menuItemId);
      const menuItems = await MenuItem.find({ storeId: req.storeId, _id: { $in: menuItemIds } });

      // Check all items exist
      const foundIds = new Set(menuItems.map((m) => m._id.toString()));
      const missingIds = menuItemIds.filter((id: string) => !foundIds.has(id));
      if (missingIds.length > 0) {
        throw createAppError('VALIDATION_ERROR', `Menu items not found: ${missingIds.join(', ')}`);
      }

      // Check for sold out items
      const soldOutItems = menuItems.filter((m) => m.isSoldOut);
      if (soldOutItems.length > 0) {
        throw createAppError('ITEM_SOLD_OUT', 'Some items are sold out', {
          soldOutItemIds: soldOutItems.map((m) => m._id.toString()),
        });
      }

      // Build a lookup map for menu items
      const menuItemMap = new Map(menuItems.map((m) => [m._id.toString(), m as MenuItemForOrder]));

      // Build updated order items with price/name snapshots
      const orderItems = await buildOrderItemsPayload(req.storeId!, items, menuItemMap);

      const updated = await Order.findOneAndUpdate(
        { _id: id, storeId: req.storeId },
        { $set: { items: orderItems } },
        { new: true },
      );

      io.to(storeIoRoom(req.storeId!)).emit('order:updated', updated);

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/orders/:id — Cancel/delete a pending order
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order } = orderModels();
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid order ID');
      }

      const order = await Order.findOne({ _id: id, storeId: req.storeId });
      if (!order) {
        throw createAppError('NOT_FOUND', 'Order not found');
      }

      if (order.status !== 'pending') {
        throw createAppError('ORDER_NOT_MODIFIABLE', 'Only pending orders can be cancelled', {
          currentStatus: order.status,
        });
      }

      await Order.findOneAndDelete({ _id: id, storeId: req.storeId });

      io.to(storeIoRoom(req.storeId!)).emit('order:cancelled', { orderId: id, tableNumber: order.tableNumber });

      res.json({ message: 'Order cancelled successfully' });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/orders/:id/toggle-hide — Toggle hide status for cash orders
  router.put('/:id/toggle-hide', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Order } = orderModels();
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid order ID');
      }

      const order = await Order.findOne({ _id: id, storeId: req.storeId });
      if (!order) {
        throw createAppError('NOT_FOUND', 'Order not found');
      }

      // Toggle between normal and hide status
      const toggleMap: Record<string, string> = {
        'completed': 'completed-hide',
        'completed-hide': 'completed',
        'checked_out': 'checked_out-hide',
        'checked_out-hide': 'checked_out',
      };

      const newStatus = toggleMap[order.status];
      if (!newStatus) {
        throw createAppError('VALIDATION_ERROR', 'Order status cannot be toggled', {
          currentStatus: order.status,
        });
      }

      const updated = await Order.findOneAndUpdate(
        { _id: id, storeId: req.storeId },
        { $set: { status: newStatus } },
        { new: true },
      );

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
