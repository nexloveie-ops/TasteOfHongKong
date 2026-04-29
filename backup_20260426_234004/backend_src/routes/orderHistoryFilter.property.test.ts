import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as fc from 'fast-check';
import express from 'express';
import http from 'http';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer } from 'socket.io';
import reportsRouter from './reports';
import { errorHandler } from '../middleware/errorHandler';
import { Order } from '../models/Order';
import { Checkout } from '../models/Checkout';
import { getJwtSecret } from '../middleware/auth';

/**
 * Feature: restaurant-ordering-system, Property 20: 订单历史筛选正确性
 *
 * For any set of checked-out orders and any filter conditions (date range, order type),
 * every returned order satisfies all filter conditions, and no qualifying order is omitted.
 *
 * **Validates: Requirements 15.1**
 */

let mongoServer: MongoMemoryServer;
let app: express.Express;
let httpServer: http.Server;
let io: SocketIOServer;
let ownerToken: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({
    instance: { launchTimeout: 60000 },
  });
  await mongoose.connect(mongoServer.getUri());

  app = express();
  app.use(express.json());

  httpServer = http.createServer(app);
  io = new SocketIOServer(httpServer, { cors: { origin: '*' } });

  app.use('/api/reports', reportsRouter);
  app.use(errorHandler);

  ownerToken = jwt.sign(
    { userId: 'test-owner-id', username: 'owner', role: 'owner' },
    getJwtSecret(),
    { expiresIn: '1h' },
  );

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
});

// --- Arbitraries ---

const orderTypeArb = fc.constantFrom('dine_in', 'takeout') as fc.Arbitrary<'dine_in' | 'takeout'>;

// Generate a day offset within a 30-day window (use offsets to avoid timezone issues)
const dayOffsetArb = fc.integer({ min: 0, max: 29 });

function makeUTCDate(offset: number): Date {
  return new Date(Date.UTC(2024, 0, 1 + offset, 12, 0, 0, 0));
}

function makeDateString(offset: number): string {
  const d = new Date(Date.UTC(2024, 0, 1 + offset));
  return d.toISOString().split('T')[0];
}

interface TestOrder {
  type: 'dine_in' | 'takeout';
  dayOffset: number;
}

const orderListArb = fc.array(
  fc.record({
    type: orderTypeArb,
    dayOffset: dayOffsetArb,
  }),
  { minLength: 1, maxLength: 6 },
);

const filterArb = fc.record({
  type: fc.option(orderTypeArb, { nil: undefined }),
  startOffset: fc.option(dayOffsetArb, { nil: undefined }),
  endOffset: fc.option(dayOffsetArb, { nil: undefined }),
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 20: 订单历史筛选正确性', () => {
  it('returned orders satisfy all filter conditions and no qualifying order is omitted', async () => {
    await fc.assert(
      fc.asyncProperty(orderListArb, filterArb, async (orders, filter) => {
        // Clean up from previous iteration
        await Checkout.deleteMany({});
        await Order.deleteMany({});

        const menuItemId = new mongoose.Types.ObjectId();

        // Create orders directly in DB with precise dates
        const createdOrders: Array<TestOrder & { _id: string; createdAt: Date }> = [];
        for (const o of orders) {
          const createdAt = makeUTCDate(o.dayOffset);
          const orderDoc = new Order({
            type: o.type,
            tableNumber: o.type === 'dine_in' ? 1 : undefined,
            seatNumber: o.type === 'dine_in' ? 1 : undefined,
            dailyOrderNumber: o.type === 'takeout' ? 1 : undefined,
            status: 'checked_out',
            items: [{
              menuItemId,
              quantity: 1,
              unitPrice: 10,
              itemName: 'Test',
            }],
          });
          // Override timestamps
          orderDoc.set('createdAt', createdAt, { strict: false });
          orderDoc.set('updatedAt', createdAt, { strict: false });
          await orderDoc.save({ timestamps: false });

          await Checkout.create({
            type: o.type === 'dine_in' ? 'table' : 'seat',
            totalAmount: 10,
            paymentMethod: 'cash',
            orderIds: [orderDoc._id],
            checkedOutAt: createdAt,
          });

          createdOrders.push({
            ...o,
            _id: orderDoc._id.toString(),
            createdAt,
          });
        }

        // Build query params
        const params = new URLSearchParams();
        if (filter.startOffset !== undefined) {
          params.set('startDate', makeDateString(filter.startOffset));
        }
        if (filter.endOffset !== undefined) {
          params.set('endDate', makeDateString(filter.endOffset));
        }
        if (filter.type !== undefined) {
          params.set('type', filter.type);
        }

        // Query
        const res = await request(app)
          .get(`/api/reports/orders?${params.toString()}`)
          .set('Authorization', `Bearer ${ownerToken}`);
        expect(res.status).toBe(200);

        // Compute expected set using same logic as API
        const expected = createdOrders.filter(o => {
          if (filter.type !== undefined && o.type !== filter.type) return false;
          if (filter.startOffset !== undefined) {
            const startDate = new Date(makeDateString(filter.startOffset));
            if (o.createdAt < startDate) return false;
          }
          if (filter.endOffset !== undefined) {
            const endDate = new Date(makeDateString(filter.endOffset));
            endDate.setHours(23, 59, 59, 999);
            if (o.createdAt > endDate) return false;
          }
          return true;
        });

        // Verify count matches
        expect(res.body.length).toBe(expected.length);

        // Verify every expected order is returned
        const returnedIds = new Set(res.body.map((o: { _id: string }) => o._id));
        for (const o of expected) {
          expect(returnedIds.has(o._id)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  }, 600000);
});
