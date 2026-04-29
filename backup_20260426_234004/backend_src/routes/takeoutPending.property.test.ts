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
import { DailyOrderCounter } from '../models/DailyOrderCounter';

/**
 * Feature: restaurant-ordering-system, Property 18: 外卖未取餐列表正确性
 *
 * 未取餐列表应恰好包含 checked_out 状态的外卖订单，不包含 pending 或 completed 状态的订单。
 * 标记某订单为完成后，该订单应从未取餐列表中消失。
 *
 * **Validates: Requirements 13.1, 13.2**
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
  await DailyOrderCounter.deleteMany({});
});

// --- Arbitraries ---

// Generate a list of statuses for takeout orders
const statusArb = fc.constantFrom('pending', 'checked_out', 'completed') as fc.Arbitrary<'pending' | 'checked_out' | 'completed'>;
const orderStatusListArb = fc.array(statusArb, { minLength: 1, maxLength: 8 });

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 18: 外卖未取餐列表正确性', () => {
  it('pending list should contain exactly checked_out takeout orders', async () => {
    await fc.assert(
      fc.asyncProperty(orderStatusListArb, async (statuses) => {
        // Setup
        const category = await MenuCategory.create({
          sortOrder: 1,
          translations: [{ locale: 'en-US', name: 'Cat' }],
        });
        const menuItem = await MenuItem.create({
          categoryId: category._id,
          price: 10,
          isSoldOut: false,
          translations: [{ locale: 'zh-CN', name: '测试菜品' }],
        });

        // Create takeout orders and set their statuses
        const orderIds: string[] = [];
        for (let i = 0; i < statuses.length; i++) {
          const res = await request(app)
            .post('/api/orders')
            .send({
              type: 'takeout',
              items: [{ menuItemId: menuItem._id.toString(), quantity: 1 }],
            });
          expect(res.status).toBe(201);
          orderIds.push(res.body._id);

          // Set the desired status directly in DB
          if (statuses[i] !== 'pending') {
            await Order.findByIdAndUpdate(res.body._id, { status: statuses[i] });
          }
        }

        // Query the pending (checked_out) takeout list
        const res = await request(app).get('/api/orders/takeout/pending');
        expect(res.status).toBe(200);

        const expectedCheckedOutCount = statuses.filter((s) => s === 'checked_out').length;
        expect(res.body).toHaveLength(expectedCheckedOutCount);

        // Verify all returned orders are checked_out takeout orders
        for (const order of res.body) {
          expect(order.type).toBe('takeout');
          expect(order.status).toBe('checked_out');
        }

        // Verify no pending or completed orders are in the list
        const returnedIds = new Set(res.body.map((o: { _id: string }) => o._id));
        for (let i = 0; i < statuses.length; i++) {
          if (statuses[i] === 'checked_out') {
            expect(returnedIds.has(orderIds[i])).toBe(true);
          } else {
            expect(returnedIds.has(orderIds[i])).toBe(false);
          }
        }

        // Cleanup
        await Order.deleteMany({});
        await MenuItem.deleteMany({});
        await MenuCategory.deleteMany({});
        await DailyOrderCounter.deleteMany({});
      }),
      { numRuns: 100 },
    );
  }, 300000);

  it('marking a checked_out order as complete should remove it from pending list', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (checkedOutCount) => {
          // Setup
          const category = await MenuCategory.create({
            sortOrder: 1,
            translations: [{ locale: 'en-US', name: 'Cat' }],
          });
          const menuItem = await MenuItem.create({
            categoryId: category._id,
            price: 10,
            isSoldOut: false,
            translations: [{ locale: 'zh-CN', name: '测试菜品' }],
          });

          // Create checked_out takeout orders
          const checkedOutIds: string[] = [];
          for (let i = 0; i < checkedOutCount; i++) {
            const res = await request(app)
              .post('/api/orders')
              .send({
                type: 'takeout',
                items: [{ menuItemId: menuItem._id.toString(), quantity: 1 }],
              });
            expect(res.status).toBe(201);
            await Order.findByIdAndUpdate(res.body._id, { status: 'checked_out' });
            checkedOutIds.push(res.body._id);
          }

          // Verify all are in pending list
          const beforeRes = await request(app).get('/api/orders/takeout/pending');
          expect(beforeRes.status).toBe(200);
          expect(beforeRes.body).toHaveLength(checkedOutCount);

          // Mark the first one as complete
          const completeRes = await request(app)
            .put(`/api/orders/takeout/${checkedOutIds[0]}/complete`);
          expect(completeRes.status).toBe(200);
          expect(completeRes.body.status).toBe('completed');
          expect(completeRes.body.completedAt).toBeDefined();

          // Verify it's gone from pending list
          const afterRes = await request(app).get('/api/orders/takeout/pending');
          expect(afterRes.status).toBe(200);
          expect(afterRes.body).toHaveLength(checkedOutCount - 1);

          const afterIds = afterRes.body.map((o: { _id: string }) => o._id);
          expect(afterIds).not.toContain(checkedOutIds[0]);

          // Cleanup
          await Order.deleteMany({});
          await MenuItem.deleteMany({});
          await MenuCategory.deleteMany({});
          await DailyOrderCounter.deleteMany({});
        },
      ),
      { numRuns: 100 },
    );
  }, 300000);
});
