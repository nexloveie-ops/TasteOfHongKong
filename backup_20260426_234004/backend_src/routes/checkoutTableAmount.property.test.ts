import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as fc from 'fast-check';
import express from 'express';
import http from 'http';
import request from 'supertest';
import { Server as SocketIOServer } from 'socket.io';
import { createOrdersRouter } from './orders';
import { createCheckoutRouter } from './checkout';
import { errorHandler } from '../middleware/errorHandler';
import { MenuCategory } from '../models/MenuCategory';
import { MenuItem } from '../models/MenuItem';
import { Order } from '../models/Order';
import { Checkout } from '../models/Checkout';

/**
 * Feature: restaurant-ordering-system, Property 5: 整桌结账金额汇总正确性
 *
 * 整桌结账总金额等于该桌所有座位订单中各菜品（单价 × 数量）之和。
 *
 * **Validates: Requirements 4.1**
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
  app.use('/api/checkout', createCheckoutRouter(io));
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
  await Checkout.deleteMany({});
  await Order.deleteMany({});
  await MenuItem.deleteMany({});
  await MenuCategory.deleteMany({});
});

// --- Arbitraries ---

const priceArb = fc.integer({ min: 1, max: 9999 }).map((n) => n / 100);
const quantityArb = fc.integer({ min: 1, max: 10 });
const seatNumberArb = fc.integer({ min: 1, max: 10 });

const seatOrderArb = fc.record({
  seatNumber: seatNumberArb,
  items: fc.array(
    fc.record({ price: priceArb, quantity: quantityArb }),
    { minLength: 1, maxLength: 3 },
  ),
});

const tableOrdersArb = fc.record({
  tableNumber: fc.integer({ min: 1, max: 50 }),
  seats: fc.array(seatOrderArb, { minLength: 1, maxLength: 4 }),
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 5: 整桌结账金额汇总正确性', () => {
  it('table checkout totalAmount equals sum of all items (unitPrice * quantity) across all seats', async () => {
    await fc.assert(
      fc.asyncProperty(tableOrdersArb, async ({ tableNumber, seats }) => {
        // 1. Create category
        const category = await MenuCategory.create({
          sortOrder: 1,
          translations: [{ locale: 'en-US', name: 'Cat' }],
        });

        // 2. Create menu items and orders for each seat
        let expectedTotal = 0;
        for (const seat of seats) {
          const orderItems = [];
          for (const item of seat.items) {
            const menuItem = await MenuItem.create({
              categoryId: category._id,
              price: item.price,
              isSoldOut: false,
              translations: [{ locale: 'zh-CN', name: '菜' }],
            });
            orderItems.push({
              menuItemId: menuItem._id,
              quantity: item.quantity,
              unitPrice: item.price,
              itemName: '菜',
            });
            expectedTotal += item.price * item.quantity;
          }

          await Order.create({
            type: 'dine_in',
            tableNumber,
            seatNumber: seat.seatNumber,
            status: 'pending',
            items: orderItems,
          });
        }

        // 3. Checkout the table
        const res = await request(app)
          .post(`/api/checkout/table/${tableNumber}`)
          .send({ paymentMethod: 'cash' });

        expect(res.status).toBe(201);

        // Property: totalAmount equals expected sum
        expect(Math.abs(res.body.totalAmount - expectedTotal)).toBeLessThan(0.01);

        // Cleanup
        await Checkout.deleteMany({});
        await Order.deleteMany({});
        await MenuItem.deleteMany({});
        await MenuCategory.deleteMany({});
      }),
      { numRuns: 100 },
    );
  }, 300000);
});
