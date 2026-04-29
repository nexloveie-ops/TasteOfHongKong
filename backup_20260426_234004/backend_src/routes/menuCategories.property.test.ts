import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import express from 'express';
import request from 'supertest';
import { MenuCategory } from '../models/MenuCategory';
import { MenuItem } from '../models/MenuItem';
import menuCategoriesRouter from './menuCategories';
import { errorHandler } from '../middleware/errorHandler';
import { getJwtSecret } from '../middleware/auth';

/**
 * Feature: restaurant-ordering-system, Property 11: 分类删除保护
 *
 * 当分类下存在关联菜品时删除操作应被拒绝（409 CATEGORY_HAS_ITEMS），
 * 当分类下无关联菜品时删除操作应成功（200）。
 *
 * **Validates: Requirements 7.3**
 */

let mongoServer: MongoMemoryServer;
let app: express.Express;
let ownerToken: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({
    instance: { launchTimeout: 60000 },
  });
  await mongoose.connect(mongoServer.getUri());

  // Build a minimal Express app with the menuCategories router + error handler
  app = express();
  app.use(express.json());
  app.use('/api/menu/categories', menuCategoriesRouter);
  app.use(errorHandler);

  // Generate an owner JWT token for authenticated requests
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

afterEach(async () => {
  await MenuItem.deleteMany({});
  await MenuCategory.deleteMany({});
});

// --- Arbitraries ---

const localeArb = fc.constantFrom('zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR');

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

const categoryTranslationArb = fc.record({
  locale: localeArb,
  name: nonEmptyStringArb,
});

const categoryDataArb = fc.record({
  sortOrder: fc.integer({ min: 0, max: 10000 }),
  translations: fc.array(categoryTranslationArb, { minLength: 1, maxLength: 3 }),
});

const menuItemCountArb = fc.integer({ min: 0, max: 5 });

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 11: 分类删除保护', () => {
  it('should reject deletion when category has associated menu items, and succeed when it has none', async () => {
    await fc.assert(
      fc.asyncProperty(categoryDataArb, menuItemCountArb, async (catData, itemCount) => {
        // 1. Create the category via API
        const createRes = await request(app)
          .post('/api/menu/categories')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(catData);

        expect(createRes.status).toBe(201);
        const categoryId = createRes.body._id;

        // 2. Optionally create menu items referencing this category
        if (itemCount > 0) {
          const items = Array.from({ length: itemCount }, (_, i) => ({
            categoryId,
            price: 10 + i,
            translations: [{ locale: 'en-US', name: `Item ${i}` }],
          }));
          await MenuItem.insertMany(items);
        }

        // 3. Attempt to delete the category
        const deleteRes = await request(app)
          .delete(`/api/menu/categories/${categoryId}`)
          .set('Authorization', `Bearer ${ownerToken}`);

        if (itemCount > 0) {
          // Category has items → deletion should be rejected with 409
          expect(deleteRes.status).toBe(409);
          expect(deleteRes.body.error.code).toBe('CATEGORY_HAS_ITEMS');
          expect(deleteRes.body.error.details.count).toBe(itemCount);

          // Category should still exist
          const stillExists = await MenuCategory.findById(categoryId);
          expect(stillExists).not.toBeNull();
        } else {
          // No items → deletion should succeed
          expect(deleteRes.status).toBe(200);

          // Category should be gone
          const gone = await MenuCategory.findById(categoryId);
          expect(gone).toBeNull();
        }

        // Cleanup for next iteration
        await MenuItem.deleteMany({ categoryId });
        await MenuCategory.findByIdAndDelete(categoryId);
      }),
      { numRuns: 100 },
    );
  }, 120000);
});
