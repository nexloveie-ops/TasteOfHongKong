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
import { Checkout } from '../models/Checkout';
import { getJwtSecret } from '../middleware/auth';

/**
 * Feature: restaurant-ordering-system, Property 21: 营业报表统计正确性
 *
 * For any set of checkouts within a date range, the report's totalRevenue equals
 * the sum of all checkout amounts, orderCount equals the total number of checkouts,
 * and cashTotal/cardTotal/mixedTotal are each correctly computed.
 *
 * **Validates: Requirements 15.2**
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
});

// --- Arbitraries ---

const paymentMethodArb = fc.constantFrom('cash', 'card', 'mixed') as fc.Arbitrary<'cash' | 'card' | 'mixed'>;

// Amount in cents-like integers to avoid floating point issues
const amountArb = fc.integer({ min: 1, max: 1000 });

// Date within a 30-day window
const dateArb = fc.integer({ min: 0, max: 29 }).map(offset => {
  const d = new Date('2024-01-01');
  d.setDate(d.getDate() + offset);
  d.setHours(12, 0, 0, 0);
  return d;
});

interface TestCheckout {
  totalAmount: number;
  paymentMethod: 'cash' | 'card' | 'mixed';
  checkedOutAt: Date;
}

const checkoutArb: fc.Arbitrary<TestCheckout> = fc.record({
  totalAmount: amountArb,
  paymentMethod: paymentMethodArb,
  checkedOutAt: dateArb,
});

const checkoutListArb = fc.array(checkoutArb, { minLength: 1, maxLength: 8 });

const dateRangeArb = fc.record({
  startOffset: fc.option(fc.integer({ min: 0, max: 29 }), { nil: undefined }),
  endOffset: fc.option(fc.integer({ min: 0, max: 29 }), { nil: undefined }),
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 21: 营业报表统计正确性', () => {
  it('summary totals match the sum of individual checkouts within date range', async () => {
    await fc.assert(
      fc.asyncProperty(checkoutListArb, dateRangeArb, async (checkouts, range) => {
        // Create checkouts in DB
        for (const c of checkouts) {
          const cashAmount = c.paymentMethod === 'cash' ? c.totalAmount :
            c.paymentMethod === 'mixed' ? Math.floor(c.totalAmount / 2) : undefined;
          const cardAmount = c.paymentMethod === 'card' ? c.totalAmount :
            c.paymentMethod === 'mixed' ? c.totalAmount - Math.floor(c.totalAmount / 2) : undefined;

          await Checkout.create({
            type: 'table',
            totalAmount: c.totalAmount,
            paymentMethod: c.paymentMethod,
            cashAmount,
            cardAmount,
            orderIds: [new mongoose.Types.ObjectId()],
            checkedOutAt: c.checkedOutAt,
          });
        }

        // Build query params
        const params = new URLSearchParams();
        let startDate: Date | undefined;
        let endDate: Date | undefined;

        if (range.startOffset !== undefined) {
          startDate = new Date('2024-01-01');
          startDate.setDate(startDate.getDate() + range.startOffset);
          params.set('startDate', startDate.toISOString().split('T')[0]);
        }
        if (range.endOffset !== undefined) {
          endDate = new Date('2024-01-01');
          endDate.setDate(endDate.getDate() + range.endOffset);
          params.set('endDate', endDate.toISOString().split('T')[0]);
        }

        // Query summary
        const res = await request(app)
          .get(`/api/reports/summary?${params.toString()}`)
          .set('Authorization', `Bearer ${ownerToken}`);
        expect(res.status).toBe(200);

        // Compute expected values
        const filtered = checkouts.filter(c => {
          if (startDate !== undefined && c.checkedOutAt < startDate) return false;
          if (endDate !== undefined) {
            const endOfDay = new Date(endDate);
            endOfDay.setHours(23, 59, 59, 999);
            if (c.checkedOutAt > endOfDay) return false;
          }
          return true;
        });

        const expectedRevenue = filtered.reduce((sum, c) => sum + c.totalAmount, 0);
        const expectedCount = filtered.length;
        const expectedCash = filtered.filter(c => c.paymentMethod === 'cash').reduce((sum, c) => sum + c.totalAmount, 0);
        const expectedCard = filtered.filter(c => c.paymentMethod === 'card').reduce((sum, c) => sum + c.totalAmount, 0);
        const expectedMixed = filtered.filter(c => c.paymentMethod === 'mixed').reduce((sum, c) => sum + c.totalAmount, 0);

        expect(res.body.totalRevenue).toBe(expectedRevenue);
        expect(res.body.orderCount).toBe(expectedCount);
        expect(res.body.cashTotal).toBe(expectedCash);
        expect(res.body.cardTotal).toBe(expectedCard);
        expect(res.body.mixedTotal).toBe(expectedMixed);

        // Cleanup
        await Checkout.deleteMany({});
      }),
      { numRuns: 100 },
    );
  }, 600000);
});
