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
 * Feature: restaurant-ordering-system, Property 7: 混合支付金额约束
 *
 * 仅当 cashAmount + cardAmount === totalAmount 时接受，否则拒绝。
 *
 * **Validates: Requirements 4.4**
 */

let mongoServer: MongoMemoryServer;
let app: express.Express;
let httpServer: http.Server;
let io: SocketIOServer;
let categoryId: string;
let menuItemId: string;

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

// --- Helpers ---

async function setupOrderForCheckout(price: number, quantity: number): Promise<string> {
  const category = await MenuCategory.create({
    sortOrder: 1,
    translations: [{ locale: 'en-US', name: 'Cat' }],
  });
  const menuItem = await MenuItem.create({
    categoryId: category._id,
    price,
    isSoldOut: false,
    translations: [{ locale: 'zh-CN', name: '菜' }],
  });
  const order = await Order.create({
    type: 'dine_in',
    tableNumber: 1,
    seatNumber: 1,
    status: 'pending',
    items: [{
      menuItemId: menuItem._id,
      quantity,
      unitPrice: price,
      itemName: '菜',
    }],
  });
  return order._id.toString();
}

// --- Arbitraries ---

const priceArb = fc.integer({ min: 1, max: 500 });
const quantityArb = fc.integer({ min: 1, max: 5 });

// Generate a valid split: cashAmount + cardAmount === totalAmount
const validSplitArb = fc.record({
  price: priceArb,
  quantity: quantityArb,
}).chain(({ price, quantity }) => {
  const total = price * quantity;
  return fc.integer({ min: 0, max: total }).map((cash) => ({
    price,
    quantity,
    totalAmount: total,
    cashAmount: cash,
    cardAmount: total - cash,
  }));
});

// Generate an invalid split: cashAmount + cardAmount !== totalAmount
const invalidSplitArb = fc.record({
  price: priceArb,
  quantity: quantityArb,
}).chain(({ price, quantity }) => {
  const total = price * quantity;
  return fc.record({
    cashAmount: fc.integer({ min: 0, max: total + 100 }),
    cardAmount: fc.integer({ min: 0, max: total + 100 }),
  }).filter(({ cashAmount, cardAmount }) => cashAmount + cardAmount !== total)
    .map(({ cashAmount, cardAmount }) => ({
      price,
      quantity,
      totalAmount: total,
      cashAmount,
      cardAmount,
    }));
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 7: 混合支付金额约束', () => {
  it('mixed payment accepted when cashAmount + cardAmount === totalAmount', async () => {
    await fc.assert(
      fc.asyncProperty(validSplitArb, async ({ price, quantity, cashAmount, cardAmount }) => {
        const orderId = await setupOrderForCheckout(price, quantity);

        const res = await request(app)
          .post(`/api/checkout/seat/${orderId}`)
          .send({ paymentMethod: 'mixed', cashAmount, cardAmount });

        expect(res.status).toBe(201);
        expect(res.body.paymentMethod).toBe('mixed');

        // Cleanup
        await Checkout.deleteMany({});
        await Order.deleteMany({});
        await MenuItem.deleteMany({});
        await MenuCategory.deleteMany({});
      }),
      { numRuns: 100 },
    );
  }, 300000);

  it('mixed payment rejected when cashAmount + cardAmount !== totalAmount', async () => {
    await fc.assert(
      fc.asyncProperty(invalidSplitArb, async ({ price, quantity, cashAmount, cardAmount }) => {
        const orderId = await setupOrderForCheckout(price, quantity);

        const res = await request(app)
          .post(`/api/checkout/seat/${orderId}`)
          .send({ paymentMethod: 'mixed', cashAmount, cardAmount });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');

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
