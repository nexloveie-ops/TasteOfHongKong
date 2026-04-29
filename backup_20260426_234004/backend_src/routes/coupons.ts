import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Coupon } from '../models/Coupon';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { createAppError } from '../middleware/errorHandler';

const router = Router();

// GET /api/coupons — List active coupons (for cashier)
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const coupons = await Coupon.find({ active: true }).sort({ createdAt: -1 }).lean();
    res.json(coupons);
  } catch (err) { next(err); }
});

// GET /api/coupons/all — List all coupons (admin)
router.get('/all', authMiddleware, requirePermission('admin:manage'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
    res.json(coupons);
  } catch (err) { next(err); }
});

// POST /api/coupons — Create coupon (admin)
router.post('/', authMiddleware, requirePermission('admin:manage'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, nameEn, amount, active } = req.body;
    if (!name) throw createAppError('VALIDATION_ERROR', 'name is required');
    if (amount == null || amount <= 0) throw createAppError('VALIDATION_ERROR', 'amount must be positive');
    const coupon = await Coupon.create({ name, nameEn, amount, active: active !== false });
    res.status(201).json(coupon);
  } catch (err) { next(err); }
});

// PUT /api/coupons/:id — Update coupon (admin)
router.put('/:id', authMiddleware, requirePermission('admin:manage'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) throw createAppError('VALIDATION_ERROR', 'Invalid ID');
    const coupon = await Coupon.findById(id);
    if (!coupon) throw createAppError('NOT_FOUND', 'Coupon not found');
    const { name, nameEn, amount, active } = req.body;
    if (name !== undefined) coupon.name = name;
    if (nameEn !== undefined) coupon.nameEn = nameEn;
    if (amount !== undefined) coupon.amount = amount;
    if (active !== undefined) coupon.active = active;
    await coupon.save();
    res.json(coupon);
  } catch (err) { next(err); }
});

// DELETE /api/coupons/:id — Delete coupon (admin)
router.delete('/:id', authMiddleware, requirePermission('admin:manage'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) throw createAppError('VALIDATION_ERROR', 'Invalid ID');
    await Coupon.findByIdAndDelete(id);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

export default router;
