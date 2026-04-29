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
 * Feature: restaurant-ordering-system, Property 17: 外卖订单按单号排序
 *
 * 未结账外卖订单查询结果应按每日单号升序排列。
 *
 * **Validates: Requirements 12.1**
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

const orderCountArb = fc.integer({ min: 2, max: 8 });

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 17: 外卖订单按单号排序', () => {
  it('GET /api/orders/takeout should return pending takeout orders sorted by dailyOrderNumber ASC', async () => {
    await fc.assert(
      fc.asyncProperty(orderCountArb, async (n) => {
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

        // Create N takeout orders
        for (let i = 0; i < n; i++) {
          const res = await request(app)
            .post('/api/orders')
            .send({
              type: 'takeout',
              items: [{ menuItemId: menuItem._id.toString(), quantity: 1 }],
            });
          expect(res.status).toBe(201);
        }

        // Query pending takeout orders
        const res = await request(app).get('/api/orders/takeout');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(n);

        // Verify sorted by dailyOrderNumber ASC
        for (let i = 1; i < res.body.length; i++) {
          expect(res.body[i].dailyOrderNumber).toBeGreaterThan(
            res.body[i - 1].dailyOrderNumber,
          );
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
});
