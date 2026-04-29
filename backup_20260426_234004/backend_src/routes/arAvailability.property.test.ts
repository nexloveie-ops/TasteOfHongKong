import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import express from 'express';
import request from 'supertest';
import { MenuItem } from '../models/MenuItem';
import { MenuCategory } from '../models/MenuCategory';
import menuItemsRouter from './menuItems';
import { errorHandler } from '../middleware/errorHandler';
import { getJwtSecret } from '../middleware/auth';

/**
 * Feature: restaurant-ordering-system, Property 14: AR可用状态标记
 *
 * 当菜品关联了 AR 文件时 API 应标记 AR 可用，未关联时标记不可用。
 * For any 菜品，当其关联了AR文件（arFileUrl 非空）时API应标记AR可用，
 * 当未关联AR文件时应标记AR不可用。
 *
 * **Validates: Requirements 9.2**
 */

let mongoServer: MongoMemoryServer;
let app: express.Express;
let ownerToken: string;
let categoryId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({
    instance: { launchTimeout: 60000 },
  });
  await mongoose.connect(mongoServer.getUri());

  app = express();
  app.use(express.json());
  app.use('/api/menu/items', menuItemsRouter);
  app.use(errorHandler);

  const payload = { userId: 'test-owner-id', username: 'owner', role: 'owner' };
  ownerToken = jwt.sign(payload, getJwtSecret(), { expiresIn: '1h' });
}, 120000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}, 30000);

beforeEach(async () => {
  const cat = await MenuCategory.create({
    sortOrder: 1,
    translations: [{ locale: 'en-US', name: 'Test Category' }],
  });
  categoryId = cat._id.toString();
});

afterEach(async () => {
  await MenuItem.deleteMany({});
  await MenuCategory.deleteMany({});
});

// --- Arbitraries ---

const localeArb = fc.constantFrom('zh-CN', 'en-US', 'ja-JP', 'ko-KR');

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

const translationArb = fc.record({
  locale: localeArb,
  name: nonEmptyStringArb,
  description: fc.string({ minLength: 0, maxLength: 50 }),
});

// A non-empty arFileUrl string (simulates an uploaded AR file path)
const arFileUrlArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => s.trim().length > 0)
  .map((s) => `/uploads/ar/${s.replace(/[^a-zA-Z0-9._-]/g, 'x')}.usdz`);

// Generate menu item data with explicit arFileUrl presence control
const menuItemWithArArb = fc.record({
  price: fc.double({ min: 0.01, max: 9999, noNaN: true, noDefaultInfinity: true }),
  translations: fc.array(translationArb, { minLength: 1, maxLength: 3 }),
  arFileUrl: arFileUrlArb,
});

const menuItemWithoutArArb = fc.record({
  price: fc.double({ min: 0.01, max: 9999, noNaN: true, noDefaultInfinity: true }),
  translations: fc.array(translationArb, { minLength: 1, maxLength: 3 }),
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 14: AR可用状态标记', () => {
  it('items with arFileUrl set should have arFileUrl populated in GET response', async () => {
    await fc.assert(
      fc.asyncProperty(menuItemWithArArb, async (data) => {
        // Create item with arFileUrl via direct DB insert
        const item = await MenuItem.create({
          categoryId,
          price: data.price,
          arFileUrl: data.arFileUrl,
          translations: data.translations,
        });

        // Query via API
        const res = await request(app).get('/api/menu/items');
        expect(res.status).toBe(200);

        const found = res.body.find(
          (i: { _id: string }) => i._id === item._id.toString(),
        );
        expect(found).toBeDefined();
        // arFileUrl should be present and non-empty (AR available)
        expect(found.arFileUrl).toBeTruthy();
        expect(typeof found.arFileUrl).toBe('string');
        expect(found.arFileUrl.length).toBeGreaterThan(0);

        // Cleanup
        await MenuItem.findByIdAndDelete(item._id);
      }),
      { numRuns: 100 },
    );
  }, 120000);

  it('items without arFileUrl should have arFileUrl absent or null in GET response', async () => {
    await fc.assert(
      fc.asyncProperty(menuItemWithoutArArb, async (data) => {
        // Create item without arFileUrl
        const item = await MenuItem.create({
          categoryId,
          price: data.price,
          translations: data.translations,
          // arFileUrl intentionally omitted
        });

        // Query via API
        const res = await request(app).get('/api/menu/items');
        expect(res.status).toBe(200);

        const found = res.body.find(
          (i: { _id: string }) => i._id === item._id.toString(),
        );
        expect(found).toBeDefined();
        // arFileUrl should be absent, null, or undefined (AR not available)
        const arValue = found.arFileUrl;
        expect(!arValue).toBe(true);

        // Cleanup
        await MenuItem.findByIdAndDelete(item._id);
      }),
      { numRuns: 100 },
    );
  }, 120000);
});
