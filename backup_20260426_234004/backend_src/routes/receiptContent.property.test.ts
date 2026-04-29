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
 * Feature: restaurant-ordering-system, Property 10: 小票内容完整性
 *
 * For any 已结账订单（堂食或外卖），生成的小票数据应包含该订单类型所需的所有字段：
 * 堂食小票包含订单编号、桌号、菜品明细、各项金额、支付方式、结账时间；
 * 外卖小票包含每日单号、菜品明细、各项金额、支付方式、结账时间。
 *
 * **Validates: Requirements 6.2, 12.4**
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
const paymentMethodArb = fc.constantFrom('cash' as const, 'card' as const);

const itemArb = fc.record({
  price: priceArb,
  quantity: quantityArb,
});

const dineInArb = fc.record({
  type: fc.constant('dine_in' as const),
  tableNumber: fc.integer({ min: 1, max: 50 }),
  seatNumber: fc.integer({ min: 1, max: 10 }),
  items: fc.array(itemArb, { minLength: 1, maxLength: 3 }),
  paymentMethod: paymentMethodArb,
});

const takeoutArb = fc.record({
  type: fc.constant('takeout' as const),
  items: fc.array(itemArb, { minLength: 1, maxLength: 3 }),
  paymentMethod: paymentMethodArb,
});

const orderArb = fc.oneof(dineInArb, takeoutArb);

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 10: 小票内容完整性', () => {
  it('receipt data for dine-in contains all required fields: checkoutId, tableNumber, items, amounts, paymentMethod, checkedOutAt', async () => {
    await fc.assert(
      fc.asyncProperty(dineInArb, async (input) => {
        // 1. Create category and menu items
        const category = await MenuCategory.create({
          sortOrder: 1,
          translations: [{ locale: 'zh-CN', name: '分类' }],
        });

        const orderItems = [];
        for (const item of input.items) {
          const menuItem = await MenuItem.create({
            categoryId: category._id,
            price: item.price,
            isSoldOut: false,
            translations: [{ locale: 'zh-CN', name: '菜品' }],
          });
          orderItems.push({
            menuItemId: menuItem._id,
            quantity: item.quantity,
            unitPrice: item.price,
            itemName: '菜品',
          });
        }

        // 2. Create dine-in order
        const order = await Order.create({
          type: 'dine_in',
          tableNumber: input.tableNumber,
          seatNumber: input.seatNumber,
          status: 'pending',
          items: orderItems,
        });

        // 3. Checkout via seat endpoint
        const checkoutRes = await request(app)
          .post(`/api/checkout/seat/${order._id}`)
          .send({ paymentMethod: input.paymentMethod });

        expect(checkoutRes.status).toBe(201);
        const checkoutId = checkoutRes.body._id;

        // 4. Fetch receipt
        const receiptRes = await request(app)
          .get(`/api/checkout/receipt/${checkoutId}`);

        expect(receiptRes.status).toBe(200);
        const receipt = receiptRes.body;

        // Property: dine-in receipt contains all required fields
        expect(receipt.checkoutId).toBeDefined();
        expect(receipt.tableNumber).toBe(input.tableNumber);
        expect(receipt.totalAmount).toBeDefined();
        expect(typeof receipt.totalAmount).toBe('number');
        expect(receipt.paymentMethod).toBe(input.paymentMethod);
        expect(receipt.checkedOutAt).toBeDefined();
        expect(receipt.orders).toBeDefined();
        expect(Array.isArray(receipt.orders)).toBe(true);
        expect(receipt.orders.length).toBeGreaterThan(0);

        // Each order should have items with required fields
        for (const o of receipt.orders) {
          expect(o.items).toBeDefined();
          expect(Array.isArray(o.items)).toBe(true);
          for (const item of o.items) {
            expect(item.itemName).toBeDefined();
            expect(item.quantity).toBeDefined();
            expect(item.unitPrice).toBeDefined();
          }
        }

        // Verify total amount matches sum of items
        const expectedTotal = receipt.orders.reduce(
          (sum: number, o: { items: { unitPrice: number; quantity: number }[] }) =>
            sum + o.items.reduce((s: number, i: { unitPrice: number; quantity: number }) => s + i.unitPrice * i.quantity, 0),
          0,
        );
        expect(Math.abs(receipt.totalAmount - expectedTotal)).toBeLessThan(0.01);

        // Cleanup
        await Checkout.deleteMany({});
        await Order.deleteMany({});
        await MenuItem.deleteMany({});
        await MenuCategory.deleteMany({});
      }),
      { numRuns: 100 },
    );
  }, 300000);

  it('receipt data for takeout contains all required fields: dailyOrderNumber, items, amounts, paymentMethod, checkedOutAt', async () => {
    await fc.assert(
      fc.asyncProperty(takeoutArb, async (input) => {
        // 1. Create category and menu items
        const category = await MenuCategory.create({
          sortOrder: 1,
          translations: [{ locale: 'zh-CN', name: '分类' }],
        });

        const orderItems = [];
        for (const item of input.items) {
          const menuItem = await MenuItem.create({
            categoryId: category._id,
            price: item.price,
            isSoldOut: false,
            translations: [{ locale: 'zh-CN', name: '菜品' }],
          });
          orderItems.push({
            menuItemId: menuItem._id,
            quantity: item.quantity,
            unitPrice: item.price,
            itemName: '菜品',
          });
        }

        // 2. Create takeout order with dailyOrderNumber
        const order = await Order.create({
          type: 'takeout',
          dailyOrderNumber: Math.floor(Math.random() * 100) + 1,
          status: 'pending',
          items: orderItems,
        });

        // 3. Checkout via seat endpoint (takeout uses seat checkout)
        const checkoutRes = await request(app)
          .post(`/api/checkout/seat/${order._id}`)
          .send({ paymentMethod: input.paymentMethod });

        expect(checkoutRes.status).toBe(201);
        const checkoutId = checkoutRes.body._id;

        // 4. Fetch receipt
        const receiptRes = await request(app)
          .get(`/api/checkout/receipt/${checkoutId}`);

        expect(receiptRes.status).toBe(200);
        const receipt = receiptRes.body;

        // Property: takeout receipt contains all required fields
        expect(receipt.checkoutId).toBeDefined();
        expect(receipt.totalAmount).toBeDefined();
        expect(typeof receipt.totalAmount).toBe('number');
        expect(receipt.paymentMethod).toBe(input.paymentMethod);
        expect(receipt.checkedOutAt).toBeDefined();
        expect(receipt.orders).toBeDefined();
        expect(Array.isArray(receipt.orders)).toBe(true);
        expect(receipt.orders.length).toBeGreaterThan(0);

        // Takeout orders must have dailyOrderNumber
        for (const o of receipt.orders) {
          expect(o.type).toBe('takeout');
          expect(o.dailyOrderNumber).toBeDefined();
          expect(typeof o.dailyOrderNumber).toBe('number');
          expect(o.items).toBeDefined();
          expect(Array.isArray(o.items)).toBe(true);
          for (const item of o.items) {
            expect(item.itemName).toBeDefined();
            expect(item.quantity).toBeDefined();
            expect(item.unitPrice).toBeDefined();
          }
        }

        // Verify total amount matches sum of items
        const expectedTotal = receipt.orders.reduce(
          (sum: number, o: { items: { unitPrice: number; quantity: number }[] }) =>
            sum + o.items.reduce((s: number, i: { unitPrice: number; quantity: number }) => s + i.unitPrice * i.quantity, 0),
          0,
        );
        expect(Math.abs(receipt.totalAmount - expectedTotal)).toBeLessThan(0.01);

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
