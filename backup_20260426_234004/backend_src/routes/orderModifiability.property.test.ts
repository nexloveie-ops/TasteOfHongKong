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
 * Feature: restaurant-ordering-system, Property 3: 订单可修改性由状态决定
 *
 * 对任意订单和任意修改操作，当订单状态为 `pending` 时修改应成功且订单内容正确更新，
 * 当订单状态为 `checked_out` 或 `completed` 时修改应被拒绝且订单保持不变。
 *
 * **Validates: Requirements 2.1, 2.3**
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

const statusArb = fc.constantFrom('pending', 'checked_out', 'completed') as fc.Arbitrary<
  'pending' | 'checked_out' | 'completed'
>;

const priceArb = fc.integer({ min: 1, max: 9999 }).map((n) => n / 100);

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

const quantityArb = fc.integer({ min: 1, max: 10 });

const modificationInputArb = fc.record({
  status: statusArb,
  initialItemCount: fc.integer({ min: 1, max: 3 }),
  modItemCount: fc.integer({ min: 1, max: 3 }),
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 3: 订单可修改性由状态决定', () => {
  it('pending orders should be modifiable; checked_out/completed orders should reject modification', async () => {
    await fc.assert(
      fc.asyncProperty(modificationInputArb, async ({ status, initialItemCount, modItemCount }) => {
        // 1. Create a category
        const category = await MenuCategory.create({
          sortOrder: 1,
          translations: [{ locale: 'en-US', name: 'Test' }],
        });

        // 2. Create menu items for initial order and modification
        const totalItemsNeeded = initialItemCount + modItemCount;
        const createdItems = await Promise.all(
          Array.from({ length: totalItemsNeeded }, (_, i) =>
            MenuItem.create({
              categoryId: category._id,
              price: (i + 1) * 5,
              isSoldOut: false,
              translations: [{ locale: 'zh-CN', name: `Item${i + 1}` }],
            }),
          ),
        );

        const initialItems = createdItems.slice(0, initialItemCount);
        const modItems = createdItems.slice(initialItemCount, initialItemCount + modItemCount);

        // 3. Create order via API
        const createRes = await request(app)
          .post('/api/orders')
          .send({
            type: 'dine_in',
            tableNumber: 1,
            seatNumber: 1,
            items: initialItems.map((item) => ({
              menuItemId: item._id.toString(),
              quantity: 1,
            })),
          });

        expect(createRes.status).toBe(201);
        const orderId = createRes.body._id;

        // 4. Set order status directly in DB
        await Order.findByIdAndUpdate(orderId, { status });

        // 5. Attempt modification via PUT /api/orders/:id/items
        const modPayload = {
          items: modItems.map((item) => ({
            menuItemId: item._id.toString(),
            quantity: 2,
          })),
        };

        const modRes = await request(app)
          .put(`/api/orders/${orderId}/items`)
          .send(modPayload);

        if (status === 'pending') {
          // Modification should succeed
          expect(modRes.status).toBe(200);
          expect(modRes.body.items).toHaveLength(modItemCount);
          for (const modItem of modItems) {
            const found = modRes.body.items.find(
              (oi: { menuItemId: string }) => oi.menuItemId === modItem._id.toString(),
            );
            expect(found).toBeDefined();
            expect(found.quantity).toBe(2);
            expect(found.unitPrice).toBe(modItem.price);
          }
        } else {
          // checked_out or completed: modification should be rejected with 409
          expect(modRes.status).toBe(409);
          expect(modRes.body.error.code).toBe('ORDER_NOT_MODIFIABLE');

          // Verify order items unchanged in DB
          const unchanged = await Order.findById(orderId).lean();
          expect(unchanged!.items).toHaveLength(initialItemCount);
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
