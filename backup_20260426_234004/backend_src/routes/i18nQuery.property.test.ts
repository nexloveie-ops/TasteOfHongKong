import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as fc from 'fast-check';
import express from 'express';
import request from 'supertest';
import { MenuItem } from '../models/MenuItem';
import { MenuCategory } from '../models/MenuCategory';
import menuItemsRouter from './menuItems';
import { errorHandler } from '../middleware/errorHandler';

/**
 * Feature: restaurant-ordering-system, Property 19: 多语言查询正确性
 *
 * 按不同 locale 参数查询时，返回的菜品名称和描述应为对应语言版本的内容。
 *
 * **Validates: Requirements 14.2**
 */

let mongoServer: MongoMemoryServer;
let app: express.Express;
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

const LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES'] as const;

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/**
 * Generate a translations array with unique locales (at least 2, up to all 7).
 * Each translation has a unique locale, a non-empty name, and a description.
 */
const translationsArb = fc
  .shuffledSubarray([...LOCALES], { minLength: 2, maxLength: LOCALES.length })
  .chain((locales) =>
    fc.tuple(
      ...locales.map((locale) =>
        fc.record({
          locale: fc.constant(locale),
          name: nonEmptyStringArb,
          description: fc.string({ minLength: 0, maxLength: 60 }),
        }),
      ),
    ),
  );

const menuItemDataArb = fc.record({
  price: fc.double({ min: 0.01, max: 9999, noNaN: true, noDefaultInfinity: true }),
  translations: translationsArb,
});

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 19: 多语言查询正确性', () => {
  it('querying with lang parameter returns only the matching locale translation', async () => {
    await fc.assert(
      fc.asyncProperty(menuItemDataArb, async (data) => {
        // Create item with multiple translations
        const item = await MenuItem.create({
          categoryId,
          price: data.price,
          translations: data.translations,
        });

        // Pick a random locale from the translations to query
        const randomIndex = Math.floor(Math.random() * data.translations.length);
        const targetLocale = data.translations[randomIndex].locale;
        const expectedName = data.translations[randomIndex].name;
        const expectedDescription = data.translations[randomIndex].description;

        // Query via GET /api/menu/items?lang={locale}
        const res = await request(app).get(`/api/menu/items?lang=${targetLocale}`);
        expect(res.status).toBe(200);

        const found = res.body.find(
          (i: { _id: string }) => i._id === item._id.toString(),
        );
        expect(found).toBeDefined();

        // The translations array should contain exactly one entry for the queried locale
        expect(found.translations).toHaveLength(1);
        expect(found.translations[0].locale).toBe(targetLocale);
        expect(found.translations[0].name).toBe(expectedName);
        expect(found.translations[0].description).toBe(expectedDescription);

        // Cleanup
        await MenuItem.findByIdAndDelete(item._id);
      }),
      { numRuns: 100 },
    );
  }, 120000);

  it('querying with a locale not in translations returns empty translations array', async () => {
    await fc.assert(
      fc.asyncProperty(menuItemDataArb, async (data) => {
        // Create item
        const item = await MenuItem.create({
          categoryId,
          price: data.price,
          translations: data.translations,
        });

        // Find a locale NOT present in the translations
        const presentLocales = new Set(data.translations.map((t) => t.locale));
        const missingLocale = LOCALES.find((l) => !presentLocales.has(l));

        // Only test if there's a missing locale (guaranteed since minLength=2, maxLength=7)
        if (missingLocale) {
          const res = await request(app).get(`/api/menu/items?lang=${missingLocale}`);
          expect(res.status).toBe(200);

          const found = res.body.find(
            (i: { _id: string }) => i._id === item._id.toString(),
          );
          expect(found).toBeDefined();
          expect(found.translations).toHaveLength(0);
        }

        // Cleanup
        await MenuItem.findByIdAndDelete(item._id);
      }),
      { numRuns: 100 },
    );
  }, 120000);
});
