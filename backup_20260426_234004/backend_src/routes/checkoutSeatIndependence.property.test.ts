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
 * Feature: restaurant-ordering-system, Property 6: 按座位结账独立性
 *
 * 每个座位生成独立结账记录，金额等于该座位订单中各菜品（单价 × 数量）之和。
 *
 * **Validates: Requirements 4.2**
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

const seatOrderArb = fc.record({
  seatNumber: fc.integer({ min: 1, max: 10 }),
  items: fc.array(
    fc.record({ price: priceArb, quantity: quantityArb }),
    { minLength: 1, maxLength: 3 },
  ),
});

const tableSeatsArb = fc.record({
  tableNumber: fc.integer({ min: 1, max: 50 }),
  seats: fc.array(seatOrderArb, { minLength: 2, maxLength: 4 }),
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 6: 按座位结账独立性', () => {
  it('per-seat checkout generates independent records with correct amounts', async () => {
    await fc.assert(
      fc.asyncProperty(tableSeatsArb, async ({ tableNumber, seats }) => {
        // 1. Create category
        const category = await MenuCategory.create({
          sortOrder: 1,
          translations: [{ locale: 'en-US', name: 'Cat' }],
        });

        // 2. Create orders for each seat
        const orderData: Array<{ orderId: string; expectedAmount: number }> = [];

        for (const seat of seats) {
          const orderItems = [];
          let seatTotal = 0;

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
            seatTotal += item.price * item.quantity;
          }

          const order = await Order.create({
            type: 'dine_in',
            tableNumber,
            seatNumber: seat.seatNumber,
            status: 'pending',
            items: orderItems,
          });

          orderData.push({ orderId: order._id.toString(), expectedAmount: seatTotal });
        }

        // 3. Checkout each seat independently
        for (const { orderId, expectedAmount } of orderData) {
          const res = await request(app)
            .post(`/api/checkout/seat/${orderId}`)
            .send({ paymentMethod: 'cash' });

          expect(res.status).toBe(201);
          expect(res.body.type).toBe('seat');
          expect(res.body.orderIds).toHaveLength(1);
          expect(res.body.orderIds[0]).toBe(orderId);

          // Property: each seat's checkout amount equals its own items total
          expect(Math.abs(res.body.totalAmount - expectedAmount)).toBeLessThan(0.01);
        }

        // Property: number of checkout records equals number of seats
        const checkouts = await Checkout.find({});
        expect(checkouts).toHaveLength(seats.length);

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
