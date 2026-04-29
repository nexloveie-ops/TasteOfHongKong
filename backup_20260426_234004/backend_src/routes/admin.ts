import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Admin } from '../models/Admin';
import { SystemConfig } from '../models/SystemConfig';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { createAppError } from '../middleware/errorHandler';
import { uploadFile } from '../storage';

const router = Router();
const tempUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 5 * 1024 * 1024 } });
const UPLOAD_BASE = path.resolve(__dirname, '../../uploads');
const LOGO_DIR = path.join(UPLOAD_BASE, 'logo');
fs.mkdirSync(LOGO_DIR, { recursive: true });

// GET /api/admin/config — Get all system configs
router.get('/config', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const configs = await SystemConfig.find({}).lean();
    const configMap: Record<string, string> = {};
    for (const c of configs) {
      configMap[c.key] = c.value;
    }
    res.json(configMap);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/config — Update system configs (requires auth + config:update)
router.put('/config', authMiddleware, requirePermission('config:update'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw createAppError('VALIDATION_ERROR', 'Request body must be a key-value object');
    }

    const results: Record<string, string> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value !== 'string') {
        throw createAppError('VALIDATION_ERROR', `Value for key "${key}" must be a string`);
      }
      const doc = await SystemConfig.findOneAndUpdate(
        { key },
        { key, value },
        { upsert: true, new: true },
      );
      results[doc.key] = doc.value;
    }

    res.json(results);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/logo — Upload restaurant logo
router.post('/logo',
  tempUpload.single('logo'),
  authMiddleware,
  requirePermission('config:update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw createAppError('VALIDATION_ERROR', 'No file provided');
      }
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
        fs.unlink(req.file.path, () => {});
        throw createAppError('VALIDATION_ERROR', 'Invalid image format');
      }
      const filename = `logo${ext}`;
      const localDest = path.join(LOGO_DIR, filename);
      fs.copyFileSync(req.file.path, localDest);
      const logoUrl = await uploadFile(localDest, 'logo' as 'photos', filename);
      fs.unlink(req.file.path, () => {});

      // Save logo URL to config
      await SystemConfig.findOneAndUpdate(
        { key: 'restaurant_logo' },
        { key: 'restaurant_logo', value: logoUrl },
        { upsert: true, new: true },
      );

      res.json({ logoUrl });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/admin/users — List admins (requires auth + admin:users)
router.get('/users', authMiddleware, requirePermission('admin:users'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const admins = await Admin.find({}).select('-passwordHash').lean();
    res.json(admins);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users — Create admin (requires auth + admin:users)
router.post('/users', authMiddleware, requirePermission('admin:users'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      throw createAppError('VALIDATION_ERROR', 'username, password, and role are required');
    }

    if (!['owner', 'cashier'].includes(role)) {
      throw createAppError('VALIDATION_ERROR', 'role must be owner or cashier');
    }

    const existing = await Admin.findOne({ username });
    if (existing) {
      throw createAppError('CONFLICT', 'Username already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const admin = await Admin.create({ username, passwordHash, role });
    const result = admin.toObject();
    const { passwordHash: _ph, ...safeResult } = result;
    res.status(201).json(safeResult);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:id — Update admin (requires auth + admin:users)
router.put('/users/:id', authMiddleware, requirePermission('admin:users'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { username, password, role } = req.body;

    const admin = await Admin.findById(id);
    if (!admin) {
      throw createAppError('NOT_FOUND', 'Admin not found');
    }

    if (username !== undefined) admin.username = username;
    if (role !== undefined) {
      if (!['owner', 'cashier'].includes(role)) {
        throw createAppError('VALIDATION_ERROR', 'role must be owner or cashier');
      }
      admin.role = role;
    }
    if (password) {
      const salt = await bcrypt.genSalt(10);
      admin.passwordHash = await bcrypt.hash(password, salt);
    }

    await admin.save();
    const result = admin.toObject();
    const { passwordHash: _ph, ...safeResult } = result;
    res.json(safeResult);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:id — Delete admin (requires auth + admin:users)
router.delete('/users/:id', authMiddleware, requirePermission('admin:users'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const admin = await Admin.findByIdAndDelete(id);
    if (!admin) {
      throw createAppError('NOT_FOUND', 'Admin not found');
    }
    res.json({ message: 'Admin deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
