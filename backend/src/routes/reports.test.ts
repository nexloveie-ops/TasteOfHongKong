import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import http from 'http';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer } from 'socket.io';
import reportsRouter from './reports';
import { createOrdersRouter } from './orders';
import { createCheckoutRouter } from './checkout';
import { errorHandler } from '../middleware/errorHandler';
import { MenuCategory } from '../models/MenuCategory';
import { MenuItem } from '../models/MenuItem';
import { Order } from '../models/Order';
import { Checkout } from '../models/Checkout';
import { DailyOrderCounter } from '../models/DailyOrderCounter';
import { getJwtSecret } from '../middleware/auth';

let mongoServer: MongoMemoryServer;
let app: express.Express;
let httpServer: http.Server;
let io: SocketIOServer;
let ownerToken: string;
let cashierToken: string;
let categoryId: string;

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
  app.use('/api/reports', reportsRouter);
  app.use(errorHandler);

  ownerToken = jwt.sign(
    { userId: 'owner-id', username: 'owner', role: 'owner' },
    getJwtSecret(),
    { expiresIn: '1h' },
  );
  cashierToken = jwt.sign(
    { userId: 'cashier-id', username: 'cashier', role: 'cashier' },
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

beforeEach(async () => {
  const cat = await MenuCategory.create({
    sortOrder: 1,
    translations: [{ locale: 'en-US', name: 'Main' }],
  });
  categoryId = cat._id.toString();
});

afterEach(async () => {
  await Checkout.deleteMany({});
  await Order.deleteMany({});
  await MenuItem.deleteMany({});
  await MenuCategory.deleteMany({});
  await DailyOrderCounter.deleteMany({});
});

async function createMenuItem(price: number) {
  return MenuItem.create({
    categoryId,
    price,
    translations: [{ locale: 'zh-CN', name: '测试菜品' }],
    isSoldOut: false,
  });
}

async function createAndCheckoutOrder(type: 'dine_in' | 'takeout', price: number, paymentMethod: string, createdAt?: Date) {
  const item = await createMenuItem(price);
  const body: Record<string, unknown> = {
    type,
    items: [{ menuItemId: item._id.toString(), quantity: 1 }],
  };
  if (type === 'dine_in') {
    body.tableNumber = 1;
    body.seatNumber = 1;
  }

  const orderRes = await request(app).post('/api/orders').send(body);
  expect(orderRes.status).toBe(201);

  if (createdAt) {
    await Order.findByIdAndUpdate(orderRes.body._id, { createdAt });
  }

  // Checkout
  let checkoutRes;
  if (type === 'dine_in') {
    checkoutRes = await request(app)
      .post('/api/checkout/table/1')
      .send({ paymentMethod });
  } else {
    checkoutRes = await request(app)
      .post(`/api/checkout/seat/${orderRes.body._id}`)
      .send({ paymentMethod });
  }
  expect(checkoutRes.status).toBe(201);

  if (createdAt) {
    await Checkout.findByIdAndUpdate(checkoutRes.body._id, { checkedOutAt: createdAt });
  }

  return { orderId: orderRes.body._id, checkoutId: checkoutRes.body._id };
}

// --- Order History ---

describe('GET /api/reports/orders', () => {
  it('should return checked-out orders', async () => {
    await createAndCheckoutOrder('dine_in', 30, 'cash');

    const res = await request(app)
      .get('/api/reports/orders')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('checked_out');
    expect(res.body[0].checkout).not.toBeNull();
    expect(res.body[0].checkout.paymentMethod).toBe('cash');
  });

  it('should filter by type', async () => {
    await createAndCheckoutOrder('dine_in', 20, 'cash');

    // Create a takeout order separately
    const item2 = await createMenuItem(15);
    const takeoutRes = await request(app).post('/api/orders').send({
      type: 'takeout',
      items: [{ menuItemId: item2._id.toString(), quantity: 1 }],
    });
    expect(takeoutRes.status).toBe(201);
    await request(app)
      .post(`/api/checkout/seat/${takeoutRes.body._id}`)
      .send({ paymentMethod: 'card' });

    const res = await request(app)
      .get('/api/reports/orders?type=takeout')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].type).toBe('takeout');
  });

  it('should filter by date range', async () => {
    const item = await createMenuItem(10);
    const orderRes = await request(app).post('/api/orders').send({
      type: 'dine_in',
      tableNumber: 2,
      seatNumber: 1,
      items: [{ menuItemId: item._id.toString(), quantity: 1 }],
    });
    expect(orderRes.status).toBe(201);

    // Set to a past date
    const pastDate = new Date('2023-06-15');
    await Order.findByIdAndUpdate(orderRes.body._id, { createdAt: pastDate, status: 'checked_out' });
    await Checkout.create({
      type: 'table',
      totalAmount: 10,
      paymentMethod: 'cash',
      orderIds: [orderRes.body._id],
      checkedOutAt: pastDate,
    });

    // Query for a different date range
    const res = await request(app)
      .get('/api/reports/orders?startDate=2024-01-01&endDate=2024-12-31')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('should allow cashier with report:view', async () => {
    const res = await request(app)
      .get('/api/reports/orders')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(res.status).toBe(200);
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).get('/api/reports/orders');
    expect(res.status).toBe(401);
  });
});

// --- Revenue Summary ---

describe('GET /api/reports/summary', () => {
  it('should return correct summary for all checkouts', async () => {
    await createAndCheckoutOrder('dine_in', 50, 'cash');

    // Create another order
    const item2 = await createMenuItem(30);
    const orderRes2 = await request(app).post('/api/orders').send({
      type: 'takeout',
      items: [{ menuItemId: item2._id.toString(), quantity: 2 }],
    });
    expect(orderRes2.status).toBe(201);
    await request(app)
      .post(`/api/checkout/seat/${orderRes2.body._id}`)
      .send({ paymentMethod: 'card' });

    const res = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalRevenue).toBe(110); // 50 + 60
    expect(res.body.orderCount).toBe(2);
    expect(res.body.cashTotal).toBe(50);
    expect(res.body.cardTotal).toBe(60);
    expect(res.body.mixedTotal).toBe(0);
  });

  it('should filter by date range', async () => {
    // Create a checkout with a past date
    await Checkout.create({
      type: 'table',
      totalAmount: 100,
      paymentMethod: 'cash',
      orderIds: [new mongoose.Types.ObjectId()],
      checkedOutAt: new Date('2023-01-15'),
    });

    // Create a checkout with a recent date
    await Checkout.create({
      type: 'table',
      totalAmount: 200,
      paymentMethod: 'card',
      orderIds: [new mongoose.Types.ObjectId()],
      checkedOutAt: new Date('2024-06-15'),
    });

    const res = await request(app)
      .get('/api/reports/summary?startDate=2024-01-01&endDate=2024-12-31')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalRevenue).toBe(200);
    expect(res.body.orderCount).toBe(1);
    expect(res.body.cardTotal).toBe(200);
    expect(res.body.cashTotal).toBe(0);
  });

  it('should handle mixed payment correctly', async () => {
    await Checkout.create({
      type: 'table',
      totalAmount: 100,
      paymentMethod: 'mixed',
      cashAmount: 40,
      cardAmount: 60,
      orderIds: [new mongoose.Types.ObjectId()],
      checkedOutAt: new Date(),
    });

    const res = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalRevenue).toBe(100);
    expect(res.body.mixedTotal).toBe(100);
    expect(res.body.cashTotal).toBe(0);
    expect(res.body.cardTotal).toBe(0);
  });

  it('should allow cashier with report:view', async () => {
    const res = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(res.status).toBe(200);
  });
});

// --- VAT PDF ---

describe('GET /api/reports/vat-pdf', () => {
  it('should reject unauthenticated request', async () => {
    const res = await request(app).get('/api/reports/vat-pdf?startDate=2024-06-01&endDate=2024-06-30');
    expect(res.status).toBe(401);
  });

  it('should validate date query', async () => {
    const res = await request(app)
      .get('/api/reports/vat-pdf')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it('should return application/pdf', async () => {
    await createAndCheckoutOrder('dine_in', 25.5, 'cash', new Date('2024-06-10T12:00:00.000Z'));

    const res = await request(app)
      .get('/api/reports/vat-pdf?startDate=2024-06-01&endDate=2024-06-30')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    const raw = res.body as Buffer | string;
    const len = Buffer.isBuffer(raw) ? raw.length : Buffer.byteLength(String(raw));
    expect(len).toBeGreaterThan(500);
  });

  it('should return pdf when no checkouts in range', async () => {
    const res = await request(app)
      .get('/api/reports/vat-pdf?startDate=2020-01-01&endDate=2020-01-31')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });
});
