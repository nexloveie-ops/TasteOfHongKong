import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { getModels } from '../getModels';
import { requirePermission } from '../middleware/auth';
import { requireAuthSameStore } from '../middleware/authForStore';
import { createAppError } from '../middleware/errorHandler';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Coupon } = getModels();
    const coupons = await Coupon.find({ storeId: req.storeId, active: true }).sort({ createdAt: -1 }).lean();
    res.json(coupons);
  } catch (err) {
    next(err);
  }
});

router.get('/all', ...requireAuthSameStore, requirePermission('admin:manage'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Coupon } = getModels();
    const coupons = await Coupon.find({ storeId: req.storeId }).sort({ createdAt: -1 }).lean();
    res.json(coupons);
  } catch (err) {
    next(err);
  }
});

router.post('/', ...requireAuthSameStore, requirePermission('admin:manage'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Coupon } = getModels();
    const { name, nameEn, amount, active } = req.body;
    if (!name) throw createAppError('VALIDATION_ERROR', 'name is required');
    if (amount == null || amount <= 0) throw createAppError('VALIDATION_ERROR', 'amount must be positive');
    const coupon = await Coupon.create({
      storeId: req.storeId,
      name,
      nameEn,
      amount,
      active: active !== false,
    });
    res.status(201).json(coupon);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', ...requireAuthSameStore, requirePermission('admin:manage'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Coupon } = getModels();
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) throw createAppError('VALIDATION_ERROR', 'Invalid ID');
    const coupon = await Coupon.findOne({ _id: id, storeId: req.storeId });
    if (!coupon) throw createAppError('NOT_FOUND', 'Coupon not found');
    const { name, nameEn, amount, active } = req.body;
    if (name !== undefined) coupon.set('name', name);
    if (nameEn !== undefined) coupon.set('nameEn', nameEn);
    if (amount !== undefined) coupon.set('amount', amount);
    if (active !== undefined) coupon.set('active', active);
    await coupon.save();
    res.json(coupon);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', ...requireAuthSameStore, requirePermission('admin:manage'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Coupon } = getModels();
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) throw createAppError('VALIDATION_ERROR', 'Invalid ID');
    await Coupon.findOneAndDelete({ _id: id, storeId: req.storeId });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
