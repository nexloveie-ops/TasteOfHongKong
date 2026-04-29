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
 * Feature: restaurant-ordering-system, Property 16: 外卖每日单号递增与重置
 *
 * 同一天内创建的外卖订单序列，分配的每日单号应严格递增且无重复；
 * 跨天后第一个外卖订单的每日单号应为1。
 *
 * **Validates: Requirements 11.2, 11.3**
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

const orderCountArb = fc.integer({ min: 1, max: 8 });

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 16: 外卖每日单号递增与重置', () => {
  it('same-day takeout orders should have strictly incrementing dailyOrderNumbers 1,2,...,N', async () => {
    await fc.assert(
      fc.asyncProperty(orderCountArb, async (n) => {
        // Setup: create a menu item
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
        const dailyNumbers: number[] = [];
        for (let i = 0; i < n; i++) {
          const res = await request(app)
            .post('/api/orders')
            .send({
              type: 'takeout',
              items: [{ menuItemId: menuItem._id.toString(), quantity: 1 }],
            });
          expect(res.status).toBe(201);
          dailyNumbers.push(res.body.dailyOrderNumber);
        }

        // Verify: dailyOrderNumbers should be 1, 2, ..., N
        for (let i = 0; i < n; i++) {
          expect(dailyNumbers[i]).toBe(i + 1);
        }

        // Verify no duplicates
        const uniqueNumbers = new Set(dailyNumbers);
        expect(uniqueNumbers.size).toBe(n);

        // Cleanup
        await Order.deleteMany({});
        await MenuItem.deleteMany({});
        await MenuCategory.deleteMany({});
        await DailyOrderCounter.deleteMany({});
      }),
      { numRuns: 50 },
    );
  }, 300000);

  it('cross-day reset: after changing date, dailyOrderNumber should reset to 1', async () => {
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

        // Create N orders for today
        for (let i = 0; i < n; i++) {
          const res = await request(app)
            .post('/api/orders')
            .send({
              type: 'takeout',
              items: [{ menuItemId: menuItem._id.toString(), quantity: 1 }],
            });
          expect(res.status).toBe(201);
        }

        // Simulate cross-day: update the DailyOrderCounter date to yesterday
        const todayStr = new Date().toISOString().slice(0, 10);
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        // Rename today's counter to yesterday (simulating that today's counter doesn't exist yet)
        await DailyOrderCounter.updateOne(
          { date: todayStr },
          { $set: { date: yesterdayStr } },
        );

        // Create a new order — should get dailyOrderNumber = 1 for the new day
        const res = await request(app)
          .post('/api/orders')
          .send({
            type: 'takeout',
            items: [{ menuItemId: menuItem._id.toString(), quantity: 1 }],
          });

        expect(res.status).toBe(201);
        expect(res.body.dailyOrderNumber).toBe(1);

        // Cleanup
        await Order.deleteMany({});
        await MenuItem.deleteMany({});
        await MenuCategory.deleteMany({});
        await DailyOrderCounter.deleteMany({});
      }),
      { numRuns: 50 },
    );
  }, 300000);
});
