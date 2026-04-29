import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import express from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { MenuItem } from '../models/MenuItem';
import { MenuCategory } from '../models/MenuCategory';
import menuItemsRouter from './menuItems';
import { errorHandler } from '../middleware/errorHandler';
import { getJwtSecret } from '../middleware/auth';

/**
 * Feature: restaurant-ordering-system, Property 13: AR文件格式验证
 *
 * 系统应仅接受 USDZ 格式的 AR 文件，拒绝其他格式。
 * For any 上传的文件，系统应仅接受USDZ格式的AR文件，拒绝其他格式的文件上传。
 *
 * **Validates: Requirements 9.1**
 */

let mongoServer: MongoMemoryServer;
let app: express.Express;
let ownerToken: string;
let categoryId: string;
let tmpDir: string;

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

  // Create a temp directory for generated fixture files
  tmpDir = path.join(__dirname, '__ar_pbt_fixtures__');
  fs.mkdirSync(tmpDir, { recursive: true });
}, 120000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
  // Clean up temp fixtures
  fs.rmSync(tmpDir, { recursive: true, force: true });
  // Clean up uploaded files
  const uploadsDir = path.resolve(__dirname, '../../uploads');
  fs.rmSync(uploadsDir, { recursive: true, force: true });
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

// Generate non-USDZ file extensions (common 3D, document, image, and random extensions)
const knownNonUsdzExts = [
  '.obj', '.fbx', '.gltf', '.glb', '.stl', '.3ds', '.dae', '.ply',
  '.pdf', '.doc', '.txt', '.html', '.xml', '.json', '.csv',
  '.jpg', '.png', '.gif', '.bmp', '.svg', '.webp',
  '.mp3', '.mp4', '.avi', '.mov', '.zip', '.tar', '.gz',
];

const randomExtArb = fc
  .string({ minLength: 1, maxLength: 8 })
  .filter((s) => /^[a-zA-Z0-9]+$/.test(s))
  .map((s) => `.${s.toLowerCase()}`)
  .filter((ext) => ext !== '.usdz');

const nonUsdzExtArb = fc.oneof(
  fc.constantFrom(...knownNonUsdzExts),
  randomExtArb,
);

// --- Helper ---

async function createMenuItem(): Promise<string> {
  const item = await MenuItem.create({
    categoryId,
    price: 10,
    translations: [{ locale: 'en-US', name: 'Test Item' }],
  });
  return item._id.toString();
}

function createTempFile(filename: string): string {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, 'fake-file-content');
  return filePath;
}

// --- Tests ---

describe('Feature: restaurant-ordering-system, Property 13: AR文件格式验证', () => {
  it('should accept USDZ files with 200 success', async () => {
    // Even though USDZ is a single format, we test it across many iterations
    // to ensure consistency with varying menu items
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 999999 }),
        async (seed) => {
          const itemId = await createMenuItem();
          const filename = `model_${seed}.usdz`;
          const filePath = createTempFile(filename);

          const res = await request(app)
            .post(`/api/menu/items/${itemId}/ar`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .attach('ar', filePath);

          expect(res.status).toBe(200);
          expect(res.body.arFileUrl).toMatch(/^\/uploads\/ar\/.+\.usdz$/);

          // Cleanup iteration data
          await MenuItem.findByIdAndDelete(itemId);
          fs.unlinkSync(filePath);
        },
      ),
      { numRuns: 50 },
    );
  }, 120000);

  it('should reject non-USDZ files with 400 INVALID_FILE_FORMAT', async () => {
    await fc.assert(
      fc.asyncProperty(nonUsdzExtArb, async (ext) => {
        const itemId = await createMenuItem();
        const filename = `model_${Date.now()}${ext}`;
        const filePath = createTempFile(filename);

        const res = await request(app)
          .post(`/api/menu/items/${itemId}/ar`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .attach('ar', filePath);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_FILE_FORMAT');

        // Cleanup iteration data
        await MenuItem.findByIdAndDelete(itemId);
        fs.unlinkSync(filePath);
      }),
      { numRuns: 100 },
    );
  }, 120000);
});
