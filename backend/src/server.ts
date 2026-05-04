import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import { connectDB } from './db';
import { errorHandler } from './middleware/errorHandler';
import { getFileStream, USE_GCS } from './storage';
import authRouter from './routes/auth';
import menuCategoriesRouter from './routes/menuCategories';
import menuItemsRouter from './routes/menuItems';
import allergensRouter from './routes/allergens';
import { createOrdersRouter } from './routes/orders';
import { createCheckoutRouter } from './routes/checkout';
import adminRouter from './routes/admin';
import optionGroupTemplatesRouter from './routes/optionGroupTemplates';
import reportsRouter from './routes/reports';
import offersRouter from './routes/offers';
import { createPaymentsRouter } from './routes/payments';
import couponsRouter from './routes/coupons';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Serve uploaded files: GCS proxy or local static
const uploadsPath = path.join(__dirname, '..', 'uploads');
if (USE_GCS) {
  // Proxy /uploads/* to GCS
  app.get('/uploads/:folder/:filename', async (req, res) => {
    try {
      const filePath = `${req.params.folder}/${req.params.filename}`;
      const result = await getFileStream(filePath);
      if (!result) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        return;
      }
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      result.stream.pipe(res);
    } catch {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch file' } });
    }
  });
} else {
  app.use('/uploads', express.static(uploadsPath));
}

// Serve frontend static files in production
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Auth routes
app.use('/api/auth', authRouter);

// Menu categories routes
app.use('/api/menu/categories', menuCategoriesRouter);

// Menu items routes
app.use('/api/menu/items', menuItemsRouter);

// Allergen routes
app.use('/api/allergens', allergensRouter);

// Orders routes
app.use('/api/orders', createOrdersRouter(io));

// Checkout routes
app.use('/api/checkout', createCheckoutRouter(io));

// Admin routes
app.use('/api/admin', adminRouter);
app.use('/api/admin/option-group-templates', optionGroupTemplatesRouter);

// Reports routes
app.use('/api/reports', reportsRouter);

// Offers routes
app.use('/api/offers', offersRouter);

// Payments routes
app.use('/api/payments', createPaymentsRouter(io));

// Coupons routes
app.use('/api/coupons', couponsRouter);

// SPA fallback: serve index.html for non-API routes (Express 5 syntax)
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Unified error handler (must be after all routes)
app.use(errorHandler);

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 8080;

async function startServer() {
  try {
    await connectDB();
  } catch (err) {
    console.error('数据库连接失败:', err);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();

export { app, server, io };
