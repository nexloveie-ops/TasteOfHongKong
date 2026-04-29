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
 * Feature: restaurant-ordering-system, Property 15: 售罄菜品不可加入订单
 *
 * 订单创建请求中包含售罄菜品时，系统应拒绝（409 ITEM_SOLD_OUT）。
 * 当所有菜品均未售罄时，订单创建应成功（201）。
 *
 * **Validates: Requirements 10.2**
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
const quantityArb = fc.integer({ min: 1, max: 10 });

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

/** Generate a list of menu item specs, each with a name, price, and isSoldOut flag */
const menuItemSpecArb = fc.record({
  price: priceArb,
  itemName: nonEmptyStringArb,
  isSoldOut: fc.boolean(),
});

/**
 * Generate order input where at least one item is sold out.
 * We generate 1-5 items, then ensure at least one has isSoldOut=true.
 */
const orderWithSoldOutArb = fc.record({
  tableNumber: tableNumberArb,
  seatNumber: seatNumberArb,
  items: fc
    .array(menuItemSpecArb, { minLength: 1, maxLength: 5 })
    .chain((items) => {
      const hasSoldOut = items.some((i) => i.isSoldOut);
      if (hasSoldOut) return fc.constant(items);
      // Force at least one item to be sold out by picking a random index
      return fc.integer({ min: 0, max: items.length - 1 }).map((idx) => {
        const copy = items.map((i) => ({ ...i }));
        copy[idx].isSoldOut = true;
        return copy;
      });
    }),
});

/**
 * Generate order input where NO items are sold out.
 */
const orderAllAvailableArb = fc.record({
  tableNumber: tableNumberArb,
  seatNumber: seatNumberArb,
  items: fc.array(
    fc.record({
      price: priceArb,
      itemName: nonEmptyStringArb,
      quantity: quantityArb,
    }),
    { minLength: 1, maxLength: 5 },
  ),
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 15: 售罄菜品不可加入订单', () => {
  it('should reject order creation (409 ITEM_SOLD_OUT) when any item is sold out', async () => {
    await fc.assert(
      fc.asyncProperty(orderWithSoldOutArb, async ({ tableNumber, seatNumber, items }) => {
        // 1. Create a category
        const category = await MenuCategory.create({
          sortOrder: 1,
          translations: [{ locale: 'en-US', name: 'Test Category' }],
        });

        // 2. Create menu items in DB with their sold-out status
        const createdItems = await Promise.all(
          items.map((spec) =>
            MenuItem.create({
              categoryId: category._id,
              price: spec.price,
              isSoldOut: spec.isSoldOut,
              translations: [{ locale: 'zh-CN', name: spec.itemName }],
            }),
          ),
        );

        // 3. Build request items (all items in the order)
        const requestItems = createdItems.map((dbItem) => ({
          menuItemId: dbItem._id.toString(),
          quantity: 1,
        }));

        // 4. POST /api/orders
        const res = await request(app)
          .post('/api/orders')
          .send({
            type: 'dine_in',
            tableNumber,
            seatNumber,
            items: requestItems,
          });

        // 5. Should be rejected with 409 and ITEM_SOLD_OUT
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('ITEM_SOLD_OUT');

        // 6. Verify soldOutItemIds in details contains exactly the sold-out items
        const expectedSoldOutIds = createdItems
          .filter((_, idx) => items[idx].isSoldOut)
          .map((m) => m._id.toString())
          .sort();
        const actualSoldOutIds = (res.body.error.details.soldOutItemIds as string[]).sort();
        expect(actualSoldOutIds).toEqual(expectedSoldOutIds);

        // Cleanup for next iteration
        await Order.deleteMany({});
        await MenuItem.deleteMany({});
        await MenuCategory.deleteMany({});
      }),
      { numRuns: 100 },
    );
  }, 300000);

  it('should succeed (201) when no items are sold out', async () => {
    await fc.assert(
      fc.asyncProperty(orderAllAvailableArb, async ({ tableNumber, seatNumber, items }) => {
        // 1. Create a category
        const category = await MenuCategory.create({
          sortOrder: 1,
          translations: [{ locale: 'en-US', name: 'Test Category' }],
        });

        // 2. Create menu items in DB — all available (not sold out)
        const createdItems = await Promise.all(
          items.map((spec) =>
            MenuItem.create({
              categoryId: category._id,
              price: spec.price,
              isSoldOut: false,
              translations: [{ locale: 'zh-CN', name: spec.itemName }],
            }),
          ),
        );

        // 3. Build request items
        const requestItems = createdItems.map((dbItem, idx) => ({
          menuItemId: dbItem._id.toString(),
          quantity: items[idx].quantity,
        }));

        // 4. POST /api/orders
        const res = await request(app)
          .post('/api/orders')
          .send({
            type: 'dine_in',
            tableNumber,
            seatNumber,
            items: requestItems,
          });

        // 5. Should succeed with 201
        expect(res.status).toBe(201);
        expect(res.body.type).toBe('dine_in');
        expect(res.body.items).toHaveLength(items.length);

        // Cleanup for next iteration
        await Order.deleteMany({});
        await MenuItem.deleteMany({});
        await MenuCategory.deleteMany({});
      }),
      { numRuns: 100 },
    );
  }, 300000);
});
