import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as fc from 'fast-check';
import express from 'express';
import http from 'http';
import request from 'supertest';
import { Server as SocketIOServer } from 'socket.io';
import { createOrdersRouter } from './orders';
import { errorHandler } from '../middleware/errorHandler';
import { MenuCategory } from '../models/MenuCategory';
import { MenuItem } from '../models/MenuItem';
import { Order } from '../models/Order';

/**
 * Feature: restaurant-ordering-system, Property 2: 堂食订单创建数据完整性
 *
 * 创建的堂食订单应包含所有选择的菜品、正确的数量、正确关联的桌号和座位号。
 * 订单项应包含正确的 menuItemId、quantity、unitPrice 快照和 itemName 快照。
 *
 * **Validates: Requirements 1.2**
 */

let mongoServer: MongoMemoryServer;
let app: express.Express;
let httpServer: http.Server;
let io: SocketIOServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({
    instance: { launchTimeout: 60000 },
  });
  await mongoose.connect(mongoServer.getUri());

  app = express();
  app.use(express.json());

  httpServer = http.createServer(app);
  io = new SocketIOServer(httpServer, { cors: { origin: '*' } });

  app.use('/api/orders', createOrdersRouter(io));
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
}, 120000);

afterAll(async () => {
  io.close();
  httpServer.close();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}, 30000);

afterEach(async () => {
  await Order.deleteMany({});
  await MenuItem.deleteMany({});
  await MenuCategory.deleteMany({});
});

// --- Arbitraries ---

const tableNumberArb = fc.integer({ min: 1, max: 100 });
const seatNumberArb = fc.integer({ min: 1, max: 20 });

const priceArb = fc.integer({ min: 1, max: 9999 }).map((n) => n / 100);

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

const menuItemDataArb = fc.record({
  price: priceArb,
  itemName: nonEmptyStringArb,
});

const quantityArb = fc.integer({ min: 1, max: 10 });

const orderInputArb = fc.record({
  tableNumber: tableNumberArb,
  seatNumber: seatNumberArb,
  menuItems: fc.array(
    fc.record({ itemData: menuItemDataArb, quantity: quantityArb }),
    { minLength: 1, maxLength: 5 },
  ),
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 2: 堂食订单创建数据完整性', () => {
  it('dine-in order should contain all selected items with correct quantity, tableNumber, seatNumber, unitPrice and itemName snapshots', async () => {
    await fc.assert(
      fc.asyncProperty(orderInputArb, async ({ tableNumber, seatNumber, menuItems }) => {
        // 1. Create a category for the menu items
        const category = await MenuCategory.create({
          sortOrder: 1,
          translations: [{ locale: 'en-US', name: 'Test Category' }],
        });

        // 2. Create menu items in DB
        const createdItems = await Promise.all(
          menuItems.map(({ itemData }) =>
            MenuItem.create({
              categoryId: category._id,
              price: itemData.price,
              isSoldOut: false,
              translations: [{ locale: 'zh-CN', name: itemData.itemName }],
            }),
          ),
        );

        // 3. Build request items
        const requestItems = createdItems.map((dbItem, idx) => ({
          menuItemId: dbItem._id.toString(),
          quantity: menuItems[idx].quantity,
        }));

        // 4. POST /api/orders with dine_in type
        const res = await request(app)
          .post('/api/orders')
          .send({
            type: 'dine_in',
            tableNumber,
            seatNumber,
            items: requestItems,
          });

        expect(res.status).toBe(201);

        // 5. Verify order type, tableNumber, seatNumber
        expect(res.body.type).toBe('dine_in');
        expect(res.body.tableNumber).toBe(tableNumber);
        expect(res.body.seatNumber).toBe(seatNumber);

        // 6. Verify all items present with correct data
        expect(res.body.items).toHaveLength(menuItems.length);

        for (let i = 0; i < createdItems.length; i++) {
          const dbItem = createdItems[i];
          const expectedQty = menuItems[i].quantity;
          const expectedName = menuItems[i].itemData.itemName;

          const orderItem = res.body.items.find(
            (oi: { menuItemId: string }) => oi.menuItemId === dbItem._id.toString(),
          );

          expect(orderItem).toBeDefined();
          expect(orderItem.quantity).toBe(expectedQty);
          expect(orderItem.unitPrice).toBe(dbItem.price);
          expect(orderItem.itemName).toBe(expectedName);
        }

        // Cleanup for next iteration
        await Order.deleteMany({});
        await MenuItem.deleteMany({});
        await MenuCategory.deleteMany({});
      }),
      { numRuns: 100 },
    );
  }, 300000);
});
