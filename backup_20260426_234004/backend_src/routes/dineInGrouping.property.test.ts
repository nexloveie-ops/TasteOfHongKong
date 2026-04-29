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
 * Feature: restaurant-ordering-system, Property 4: 堂食订单按桌号分组查询正确性
 *
 * 返回结果只包含 pending 状态的订单，每个桌号下包含该桌所有座位的完整订单明细。
 *
 * **Validates: Requirements 3.1, 3.3**
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

const statusArb = fc.constantFrom('pending', 'checked_out', 'completed');
const tableNumberArb = fc.integer({ min: 1, max: 10 });
const seatNumberArb = fc.integer({ min: 1, max: 5 });
const priceArb = fc.integer({ min: 1, max: 999 }).map((n) => n / 100);

const orderSpecArb = fc.record({
  tableNumber: tableNumberArb,
  seatNumber: seatNumberArb,
  status: statusArb,
  price: priceArb,
  quantity: fc.integer({ min: 1, max: 5 }),
});

const ordersListArb = fc.array(orderSpecArb, { minLength: 1, maxLength: 8 });

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 4: 堂食订单按桌号分组查询正确性', () => {
  it('GET /api/orders/dine-in returns only pending orders, grouped correctly by table', async () => {
    await fc.assert(
      fc.asyncProperty(ordersListArb, async (orderSpecs) => {
        // 1. Create a category and menu item
        const category = await MenuCategory.create({
          sortOrder: 1,
          translations: [{ locale: 'en-US', name: 'Cat' }],
        });
        const menuItem = await MenuItem.create({
          categoryId: category._id,
          price: 10,
          isSoldOut: false,
          translations: [{ locale: 'zh-CN', name: '菜品' }],
        });

        // 2. Create orders directly in DB with various statuses
        const createdOrders = [];
        for (const spec of orderSpecs) {
          const order = await Order.create({
            type: 'dine_in',
            tableNumber: spec.tableNumber,
            seatNumber: spec.seatNumber,
            status: spec.status,
            items: [{
              menuItemId: menuItem._id,
              quantity: spec.quantity,
              unitPrice: spec.price,
              itemName: '菜品',
            }],
          });
          createdOrders.push({ ...spec, _id: order._id.toString() });
        }

        // 3. Query dine-in orders
        const res = await request(app).get('/api/orders/dine-in');
        expect(res.status).toBe(200);

        const returnedOrders = res.body as Array<{
          _id: string;
          type: string;
          status: string;
          tableNumber: number;
          seatNumber: number;
        }>;

        // Property: all returned orders must be pending
        for (const order of returnedOrders) {
          expect(order.status).toBe('pending');
          expect(order.type).toBe('dine_in');
        }

        // Property: all pending dine-in orders must be in the result
        const pendingOrders = createdOrders.filter(o => o.status === 'pending');
        const returnedIds = new Set(returnedOrders.map(o => o._id));
        for (const pending of pendingOrders) {
          expect(returnedIds.has(pending._id)).toBe(true);
        }

        // Property: no non-pending orders in result
        const nonPendingIds = new Set(
          createdOrders.filter(o => o.status !== 'pending').map(o => o._id)
        );
        for (const order of returnedOrders) {
          expect(nonPendingIds.has(order._id)).toBe(false);
        }

        // Property: results are sorted by tableNumber then seatNumber
        for (let i = 1; i < returnedOrders.length; i++) {
          const prev = returnedOrders[i - 1];
          const curr = returnedOrders[i];
          if (prev.tableNumber === curr.tableNumber) {
            expect(prev.seatNumber).toBeLessThanOrEqual(curr.seatNumber);
          } else {
            expect(prev.tableNumber).toBeLessThan(curr.tableNumber);
          }
        }

        // Cleanup
        await Order.deleteMany({});
        await MenuItem.deleteMany({});
        await MenuCategory.deleteMany({});
      }),
      { numRuns: 100 },
    );
  }, 300000);
});
