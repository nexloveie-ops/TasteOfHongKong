import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as fc from 'fast-check';
import { MenuCategory, MenuItem } from './index';

/**
 * Feature: restaurant-ordering-system, Property 12: 菜单数据持久化往返
 *
 * 对任意有效的菜品分类或菜品数据，创建后再读取应返回等价数据
 *
 * Validates: Requirements 7.1, 8.1
 */

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({
    instance: { launchTimeout: 60000 },
  });
  await mongoose.connect(mongoServer.getUri());
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
  await MenuCategory.deleteMany({});
  await MenuItem.deleteMany({});
});

// --- Arbitraries ---

const localeArb = fc.constantFrom('zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES');

const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

const categoryTranslationArb = fc.record({
  locale: localeArb,
  name: nonEmptyStringArb,
});

const categoryDataArb = fc.record({
  sortOrder: fc.integer({ min: 0, max: 10000 }),
  translations: fc.array(categoryTranslationArb, { minLength: 1, maxLength: 5 }),
});

const itemTranslationArb = fc.record({
  locale: localeArb,
  name: nonEmptyStringArb,
  description: fc.string({ minLength: 0, maxLength: 100 }),
});

const menuItemDataArb = fc.record({
  price: fc.double({ min: 0.01, max: 99999, noNaN: true, noDefaultInfinity: true }),
  calories: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: undefined }),
  avgWaitMinutes: fc.option(fc.integer({ min: 0, max: 120 }), { nil: undefined }),
  translations: fc.array(itemTranslationArb, { minLength: 1, maxLength: 5 }),
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 12: 菜单数据持久化往返', () => {
  it('MenuCategory round-trip: create then read returns equivalent data', async () => {
    await fc.assert(
      fc.asyncProperty(categoryDataArb, async (data) => {
        const created = await MenuCategory.create(data);
        const found = await MenuCategory.findById(created._id).lean();

        expect(found).not.toBeNull();
        expect(found!.sortOrder).toBe(data.sortOrder);
        expect(found!.translations).toHaveLength(data.translations.length);

        for (let i = 0; i < data.translations.length; i++) {
          expect(found!.translations[i].locale).toBe(data.translations[i].locale);
          expect(found!.translations[i].name).toBe(data.translations[i].name);
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('MenuItem round-trip: create then read returns equivalent data', async () => {
    // Create a category to use as valid categoryId
    const category = await MenuCategory.create({
      sortOrder: 1,
      translations: [{ locale: 'en', name: 'Test' }],
    });

    await fc.assert(
      fc.asyncProperty(menuItemDataArb, async (data) => {
        const itemData = { ...data, categoryId: category._id };
        const created = await MenuItem.create(itemData);
        const found = await MenuItem.findById(created._id).lean();

        expect(found).not.toBeNull();
        expect(found!.price).toBeCloseTo(data.price, 10);
        expect(found!.categoryId.toString()).toBe(category._id.toString());

        if (data.calories !== undefined) {
          expect(found!.calories).toBe(data.calories);
        }
        if (data.avgWaitMinutes !== undefined) {
          expect(found!.avgWaitMinutes).toBe(data.avgWaitMinutes);
        }

        expect(found!.translations).toHaveLength(data.translations.length);
        for (let i = 0; i < data.translations.length; i++) {
          expect(found!.translations[i].locale).toBe(data.translations[i].locale);
          expect(found!.translations[i].name).toBe(data.translations[i].name);
          expect(found!.translations[i].description).toBe(data.translations[i].description);
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);
});
