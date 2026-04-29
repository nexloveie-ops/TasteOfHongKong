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
 * Feature: restaurant-ordering-system, Property 9: 订单金额计算不变量
 *
 * 对任意订单及其菜品列表，订单总金额应始终等于所有订单项（单价 × 数量）之和。
 * 在增加或减少菜品后，重新计算的总金额应满足同样的不变量。
 *
 * **Validates: Requirements 5.2**
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

// --- Helpers ---

function computeExpectedTotal(items: Array<{ unitPrice: number; quantity: number }>): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

function computeOrderTotal(orderItems: Array<{ unitPrice: number; quantity: number }>): number {
  return orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

// --- Arbitraries ---

const priceArb = fc.integer({ min: 1, max: 9999 }).map((n) => n / 100);

const quantityArb = fc.integer({ min: 1, max: 10 });

const itemSpecArb = fc.record({
  price: priceArb,
  quantity: quantityArb,
});

const orderAmountInputArb = fc.record({
  initialItems: fc.array(itemSpecArb, { minLength: 1, maxLength: 5 }),
  modItems: fc.array(itemSpecArb, { minLength: 1, maxLength: 5 }),
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 9: 订单金额计算不变量', () => {
  it('order total should always equal sum of (unitPrice × quantity) for all items, both at creation and after modification', async () => {
    await fc.assert(
      fc.asyncProperty(orderAmountInputArb, async ({ initialItems, modItems }) => {
        // 1. Create a category
        const category = await MenuCategory.create({
          sortOrder: 1,
          translations: [{ locale: 'en-US', name: 'Test' }],
        });

        // 2. Create menu items for initial order
        const initialMenuItems = await Promise.all(
          initialItems.map((spec, i) =>
            MenuItem.create({
              categoryId: category._id,
              price: spec.price,
              isSoldOut: false,
              translations: [{ locale: 'zh-CN', name: `InitItem${i}` }],
            }),
          ),
        );

        // 3. Create order via API
        const createRes = await request(app)
          .post('/api/orders')
          .send({
            type: 'dine_in',
            tableNumber: 1,
            seatNumber: 1,
            items: initialMenuItems.map((item, idx) => ({
              menuItemId: item._id.toString(),
              quantity: initialItems[idx].quantity,
            })),
          });

        expect(createRes.status).toBe(201);

        // 4. Verify initial total invariant
        const createdOrderItems = createRes.body.items as Array<{
          unitPrice: number;
          quantity: number;
        }>;
        const initialTotal = computeOrderTotal(createdOrderItems);
        const expectedInitialTotal = computeExpectedTotal(
          initialItems.map((spec, idx) => ({
            unitPrice: initialMenuItems[idx].price,
            quantity: spec.quantity,
          })),
        );
        expect(Math.abs(initialTotal - expectedInitialTotal)).toBeLessThan(0.001);

        // 5. Create menu items for modification
        const modMenuItems = await Promise.all(
          modItems.map((spec, i) =>
            MenuItem.create({
              categoryId: category._id,
              price: spec.price,
              isSoldOut: false,
              translations: [{ locale: 'zh-CN', name: `ModItem${i}` }],
            }),
          ),
        );

        // 6. Modify order via PUT /api/orders/:id/items
        const orderId = createRes.body._id;
        const modRes = await request(app)
          .put(`/api/orders/${orderId}/items`)
          .send({
            items: modMenuItems.map((item, idx) => ({
              menuItemId: item._id.toString(),
              quantity: modItems[idx].quantity,
            })),
          });

        expect(modRes.status).toBe(200);

        // 7. Verify modified total invariant
        const modifiedOrderItems = modRes.body.items as Array<{
          unitPrice: number;
          quantity: number;
        }>;
        const modifiedTotal = computeOrderTotal(modifiedOrderItems);
        const expectedModTotal = computeExpectedTotal(
          modItems.map((spec, idx) => ({
            unitPrice: modMenuItems[idx].price,
            quantity: spec.quantity,
          })),
        );
        expect(Math.abs(modifiedTotal - expectedModTotal)).toBeLessThan(0.001);

        // Cleanup for next iteration
        await Order.deleteMany({});
        await MenuItem.deleteMany({});
        await MenuCategory.deleteMany({});
      }),
      { numRuns: 100 },
    );
  }, 300000);
});
