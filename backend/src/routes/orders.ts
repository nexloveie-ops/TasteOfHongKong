import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Server as SocketIOServer } from 'socket.io';
import { MenuItem } from '../models/MenuItem';
import { Order } from '../models/Order';
import { DailyOrderCounter } from '../models/DailyOrderCounter';
import { createAppError } from '../middleware/errorHandler';

export function createOrdersRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /api/orders — Create a new order
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { type, tableNumber, seatNumber, items, appliedBundles } = req.body;

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
      const menuItems = await MenuItem.find({ _id: { $in: menuItemIds } });

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
      const menuItemMap = new Map(menuItems.map((m) => [m._id.toString(), m]));

      // Build order items with price/name snapshots
      const orderItems = items.map((item: { menuItemId: string; quantity: number; selectedOptions?: { groupId: string; choiceId: string }[] }) => {
        const menuItem = menuItemMap.get(item.menuItemId)!;
        // Use first translation name as snapshot, fallback to 'Unknown'
        const zhTrans = menuItem.translations?.find((t: { locale: string }) => t.locale === 'zh-CN');
        const enTrans = menuItem.translations?.find((t: { locale: string }) => t.locale === 'en-US');
        const itemName = zhTrans?.name || enTrans?.name || (menuItem.translations?.[0] as { name: string })?.name || 'Unknown';
        const itemNameEn = enTrans?.name || zhTrans?.name || itemName;

        // Resolve selectedOptions from menuItem's optionGroups
        const selectedOptions: { groupName: string; choiceName: string; extraPrice: number }[] = [];
        if (item.selectedOptions && Array.isArray(item.selectedOptions)) {
          const groups = (menuItem as unknown as { optionGroups?: { _id: mongoose.Types.ObjectId; translations: { locale: string; name: string }[]; choices: { _id: mongoose.Types.ObjectId; translations: { locale: string; name: string }[]; extraPrice: number }[] }[] }).optionGroups || [];
          for (const sel of item.selectedOptions) {
            const group = groups.find((g) => g._id.toString() === sel.groupId);
            if (group) {
              const choice = group.choices.find((c) => c._id.toString() === sel.choiceId);
              if (choice) {
                const groupName = group.translations && group.translations.length > 0 ? group.translations[0].name : '';
                const choiceName = choice.translations && choice.translations.length > 0 ? choice.translations[0].name : '';
                selectedOptions.push({ groupName, choiceName, extraPrice: choice.extraPrice || 0 });
              }
            }
          }
        }

        return {
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          unitPrice: menuItem.price,
          itemName,
          itemNameEn,
          selectedOptions,
        };
      });
      const orderData: Record<string, unknown> = {
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
          { date: todayStr },
          { $inc: { currentNumber: 1 } },
          { upsert: true, returnDocument: 'after' }
        );
        orderData.dailyOrderNumber = counter!.currentNumber;
      }

      const order = await Order.create(orderData);

      // Emit Socket.IO event
      io.emit('order:new', order);

      res.status(201).json(order);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/dine-in — Get pending and paid_online dine-in orders
  router.get('/dine-in', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const orders = await Order.find({ type: 'dine_in', status: { $in: ['pending', 'paid_online'] } }).sort({ tableNumber: 1, seatNumber: 1 });
      res.json(orders);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/takeout — Get pending (not checked out) takeout orders sorted by dailyOrderNumber ASC
  router.get('/takeout', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const orders = await Order.find({ type: 'takeout', status: 'pending' }).sort({ dailyOrderNumber: 1 });
      res.json(orders);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/phone — Get pending phone orders sorted by dailyOrderNumber ASC
  router.get('/phone', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const orders = await Order.find({ type: 'phone', status: 'pending' }).sort({ dailyOrderNumber: 1 });
      res.json(orders);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/takeout/pending — Get checked_out (not completed) takeout orders
  router.get('/takeout/pending', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const orders = await Order.find({ type: 'takeout', status: 'checked_out' }).sort({ dailyOrderNumber: 1 });
      res.json(orders);
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/orders/takeout/:id/complete — Mark takeout order as completed
  router.put('/takeout/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid order ID');
      }

      const order = await Order.findById(id);
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

      order.status = 'completed';
      order.completedAt = new Date();
      await order.save();

      res.json(order);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/:id — Get order details
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid order ID');
      }

      const order = await Order.findById(id);
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
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid order ID');
      }

      const order = await Order.findById(id);
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
      const menuItems = await MenuItem.find({ _id: { $in: menuItemIds } });

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
      const menuItemMap = new Map(menuItems.map((m) => [m._id.toString(), m]));

      // Build updated order items with price/name snapshots
      const orderItems = items.map((item: { menuItemId: string; quantity: number; selectedOptions?: { groupId: string; choiceId: string }[] }) => {
        const menuItem = menuItemMap.get(item.menuItemId)!;
        const zhTrans2 = menuItem.translations?.find((t: { locale: string }) => t.locale === 'zh-CN');
        const enTrans2 = menuItem.translations?.find((t: { locale: string }) => t.locale === 'en-US');
        const itemName = zhTrans2?.name || enTrans2?.name || (menuItem.translations?.[0] as { name: string })?.name || 'Unknown';
        const itemNameEn = enTrans2?.name || zhTrans2?.name || itemName;

        // Resolve selectedOptions from menuItem's optionGroups
        const selectedOptions: { groupName: string; choiceName: string; extraPrice: number }[] = [];
        if (item.selectedOptions && Array.isArray(item.selectedOptions)) {
          const groups = (menuItem as unknown as { optionGroups?: { _id: mongoose.Types.ObjectId; translations: { locale: string; name: string }[]; choices: { _id: mongoose.Types.ObjectId; translations: { locale: string; name: string }[]; extraPrice: number }[] }[] }).optionGroups || [];
          for (const sel of item.selectedOptions) {
            const group = groups.find((g) => g._id.toString() === sel.groupId);
            if (group) {
              const choice = group.choices.find((c) => c._id.toString() === sel.choiceId);
              if (choice) {
                const groupName = group.translations && group.translations.length > 0 ? group.translations[0].name : '';
                const choiceName = choice.translations && choice.translations.length > 0 ? choice.translations[0].name : '';
                selectedOptions.push({ groupName, choiceName, extraPrice: choice.extraPrice || 0 });
              }
            }
          }
        }

        return {
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          unitPrice: menuItem.price,
          itemName,
          itemNameEn,
          selectedOptions,
        };
      });

      // Update the order's items
      order.items = orderItems as unknown as typeof order.items;
      await order.save();

      // Emit Socket.IO event
      io.emit('order:updated', order);

      res.json(order);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/orders/:id — Cancel/delete a pending order
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('VALIDATION_ERROR', 'Invalid order ID');
      }

      const order = await Order.findById(id);
      if (!order) {
        throw createAppError('NOT_FOUND', 'Order not found');
      }

      if (order.status !== 'pending') {
        throw createAppError('ORDER_NOT_MODIFIABLE', 'Only pending orders can be cancelled', {
          currentStatus: order.status,
        });
      }

      await Order.findByIdAndDelete(id);

      // Emit Socket.IO event
      io.emit('order:cancelled', { orderId: id, tableNumber: order.tableNumber });

      res.json({ message: 'Order cancelled successfully' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
