import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { getModels } from '../getModels';
import { createAppError } from '../middleware/errorHandler';
import { platformAuth } from '../middleware/requirePlatformOwner';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function models() {
  return getModels() as {
    Store: mongoose.Model<any>;
    Admin: mongoose.Model<any>;
    MenuCategory: mongoose.Model<any>;
    MenuItem: mongoose.Model<any>;
    Allergen: mongoose.Model<any>;
    OptionGroupTemplate: mongoose.Model<any>;
    OptionGroupTemplateRule: mongoose.Model<any>;
    Offer: mongoose.Model<any>;
    Coupon: mongoose.Model<any>;
    Order: mongoose.Model<any>;
    Checkout: mongoose.Model<any>;
    DailyOrderCounter: mongoose.Model<any>;
    SystemConfig: mongoose.Model<any>;
    AdminAuditLog: mongoose.Model<any>;
  };
}

function paramStr(p: string | string[] | undefined): string {
  if (typeof p === 'string') return p;
  if (Array.isArray(p) && p[0]) return p[0];
  return '';
}

const router = Router();

// GET /api/platform/stores
router.get('/stores', ...platformAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { Store } = models();
    const list = await Store.find({}).sort({ slug: 1 }).lean();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// POST /api/platform/stores — 新建店铺（URL 段 / 子域标识 = slug）
router.post('/stores', ...platformAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Store } = models();
    const { slug: rawSlug, displayName, subscriptionEndsAt } = req.body as {
      slug?: string;
      displayName?: string;
      subscriptionEndsAt?: string;
    };
    if (!rawSlug || typeof rawSlug !== 'string' || !displayName || typeof displayName !== 'string') {
      throw createAppError('VALIDATION_ERROR', 'slug 与 displayName 必填');
    }
    const slug = rawSlug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      throw createAppError('VALIDATION_ERROR', 'slug 仅允许小写字母、数字与连字符');
    }
    const exists = await Store.findOne({ slug });
    if (exists) {
      throw createAppError('CONFLICT', '该 slug 已存在');
    }
    let ends: Date;
    if (subscriptionEndsAt && typeof subscriptionEndsAt === 'string') {
      ends = new Date(subscriptionEndsAt);
      if (Number.isNaN(ends.getTime())) {
        throw createAppError('VALIDATION_ERROR', 'subscriptionEndsAt 日期无效');
      }
    } else {
      ends = new Date('2099-12-31');
    }
    const store = await Store.create({
      slug,
      displayName: displayName.trim(),
      subscriptionEndsAt: ends,
      status: 'active',
    });
    res.status(201).json(store);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/platform/stores/:id
router.patch('/stores/:id', ...platformAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Store } = models();
    const id = paramStr(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw createAppError('VALIDATION_ERROR', 'Invalid store id');
    }
    const store = await Store.findById(id);
    if (!store) {
      throw createAppError('NOT_FOUND', '店铺不存在');
    }
    const { displayName, status, subscriptionEndsAt } = req.body as {
      displayName?: string;
      status?: string;
      subscriptionEndsAt?: string;
    };
    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || !displayName.trim()) {
        throw createAppError('VALIDATION_ERROR', 'displayName 无效');
      }
      store.set('displayName', displayName.trim());
    }
    if (status !== undefined) {
      if (!['active', 'suspended', 'expired'].includes(status)) {
        throw createAppError('VALIDATION_ERROR', 'status 无效');
      }
      store.set('status', status);
    }
    if (subscriptionEndsAt !== undefined) {
      const d = new Date(subscriptionEndsAt);
      if (Number.isNaN(d.getTime())) {
        throw createAppError('VALIDATION_ERROR', 'subscriptionEndsAt 无效');
      }
      store.set('subscriptionEndsAt', d);
    }
    await store.save();
    res.json(store.toObject());
  } catch (err) {
    next(err);
  }
});

// DELETE /api/platform/stores/:id — 级联删除该店下业务数据（不可逆）
router.delete('/stores/:id', ...platformAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Store } = models();
    const id = paramStr(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw createAppError('VALIDATION_ERROR', 'Invalid store id');
    }
    const store = (await Store.findById(id).lean()) as { _id: mongoose.Types.ObjectId; slug: string } | null;
    if (!store) {
      throw createAppError('NOT_FOUND', '店铺不存在');
    }
    const { confirmSlug } = req.body as { confirmSlug?: string };
    const typed = typeof confirmSlug === 'string' ? confirmSlug.trim().toLowerCase() : '';
    if (!typed || typed !== store.slug) {
      throw createAppError(
        'VALIDATION_ERROR',
        '请在请求体中提供 confirmSlug，且必须与店铺 URL 标识完全一致以确认删除',
      );
    }

    const storeOid = new mongoose.Types.ObjectId(id);
    const m = models();

    await Promise.all([
      m.MenuCategory.deleteMany({ storeId: storeOid }),
      m.MenuItem.deleteMany({ storeId: storeOid }),
      m.Allergen.deleteMany({ storeId: storeOid }),
      m.OptionGroupTemplateRule.deleteMany({ storeId: storeOid }),
      m.OptionGroupTemplate.deleteMany({ storeId: storeOid }),
      m.Offer.deleteMany({ storeId: storeOid }),
      m.Coupon.deleteMany({ storeId: storeOid }),
      m.Order.deleteMany({ storeId: storeOid }),
      m.Checkout.deleteMany({ storeId: storeOid }),
      m.DailyOrderCounter.deleteMany({ storeId: storeOid }),
      m.SystemConfig.deleteMany({ storeId: storeOid }),
      m.Admin.deleteMany({ storeId: storeOid }),
      m.AdminAuditLog.deleteMany({ targetStoreId: storeOid }),
    ]);

    await Store.findByIdAndDelete(id);
    res.json({ message: '店铺及关联数据已删除' });
  } catch (err) {
    next(err);
  }
});

// GET /api/platform/stores/:storeId/admins
router.get('/stores/:storeId/admins', ...platformAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Admin } = models();
    const storeId = paramStr(req.params.storeId);
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      throw createAppError('VALIDATION_ERROR', 'Invalid store id');
    }
    const admins = await Admin.find({ storeId }).select('-passwordHash').lean();
    res.json(admins);
  } catch (err) {
    next(err);
  }
});

// POST /api/platform/stores/:storeId/admins — 创建店主/收银员（非 platform_owner）
router.post('/stores/:storeId/admins', ...platformAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Admin, Store } = models();
    const storeId = paramStr(req.params.storeId);
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      throw createAppError('VALIDATION_ERROR', 'Invalid store id');
    }
    const st = await Store.findById(storeId);
    if (!st) {
      throw createAppError('NOT_FOUND', '店铺不存在');
    }
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
      throw createAppError('VALIDATION_ERROR', 'username, password, role 必填');
    }
    if (!['owner', 'cashier'].includes(role)) {
      throw createAppError('VALIDATION_ERROR', 'role 须为 owner 或 cashier');
    }
    const existing = await Admin.findOne({ storeId: st._id, username: String(username).trim() });
    if (existing) {
      throw createAppError('CONFLICT', '该店下用户名已存在');
    }
    const passwordHash = await bcrypt.hash(String(password), 10);
    const admin = await Admin.create({
      storeId: st._id,
      username: String(username).trim(),
      passwordHash,
      role,
    });
    const o = admin.toObject() as Record<string, unknown>;
    delete o.passwordHash;
    res.status(201).json(o);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/platform/stores/:storeId/admins/:adminId
router.delete('/stores/:storeId/admins/:adminId', ...platformAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Admin } = models();
    const storeId = paramStr(req.params.storeId);
    const adminId = paramStr(req.params.adminId);
    if (!mongoose.Types.ObjectId.isValid(storeId) || !mongoose.Types.ObjectId.isValid(adminId)) {
      throw createAppError('VALIDATION_ERROR', 'Invalid id');
    }
    const doc = await Admin.findOneAndDelete({ _id: adminId, storeId });
    if (!doc) {
      throw createAppError('NOT_FOUND', '账号不存在');
    }
    res.json({ message: '已删除' });
  } catch (err) {
    next(err);
  }
});

export default router;
