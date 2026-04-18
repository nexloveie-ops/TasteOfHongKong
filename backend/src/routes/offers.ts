import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Offer } from '../models/Offer';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { createAppError } from '../middleware/errorHandler';

const router = Router();

// GET /api/offers — List all offers (public, for customer/cashier matching)
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const offers = await Offer.find({
      active: true,
      $or: [
        { startDate: { $exists: false } },
        { startDate: null },
        { startDate: { $lte: now } },
      ],
    }).lean();

    // Filter out expired offers
    const valid = offers.filter(o => {
      if (o.endDate && new Date(o.endDate) < now) return false;
      return true;
    });

    res.json(valid);
  } catch (err) {
    next(err);
  }
});

// GET /api/offers/all — List all offers including inactive (admin)
router.get('/all', authMiddleware, requirePermission('admin:manage'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const offers = await Offer.find().sort({ createdAt: -1 }).lean();
    res.json(offers);
  } catch (err) {
    next(err);
  }
});

// POST /api/offers — Create offer (admin)
router.post('/', authMiddleware, requirePermission('admin:manage'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, nameEn, description, descriptionEn, bundlePrice, slots, excludedItemIds, active, startDate, endDate } = req.body;

    if (!name || typeof name !== 'string') {
      throw createAppError('VALIDATION_ERROR', 'name is required');
    }
    if (bundlePrice == null || typeof bundlePrice !== 'number' || bundlePrice < 0) {
      throw createAppError('VALIDATION_ERROR', 'bundlePrice must be a non-negative number');
    }
    if (!Array.isArray(slots) || slots.length < 2) {
      throw createAppError('VALIDATION_ERROR', 'At least 2 slots are required for a bundle');
    }

    for (const slot of slots) {
      if (slot.type === 'item' && (!slot.itemId || !mongoose.Types.ObjectId.isValid(slot.itemId))) {
        throw createAppError('VALIDATION_ERROR', 'Each item slot must have a valid itemId');
      }
      if (slot.type === 'category' && (!slot.categoryId || !mongoose.Types.ObjectId.isValid(slot.categoryId))) {
        throw createAppError('VALIDATION_ERROR', 'Each category slot must have a valid categoryId');
      }
    }

    const offer = await Offer.create({
      name, nameEn, description, descriptionEn, bundlePrice, slots,
      excludedItemIds: excludedItemIds || [],
      active: active !== false,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });

    res.status(201).json(offer);
  } catch (err) {
    next(err);
  }
});

// PUT /api/offers/:id — Update offer (admin)
router.put('/:id', authMiddleware, requirePermission('admin:manage'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      throw createAppError('VALIDATION_ERROR', 'Invalid offer ID');
    }

    const offer = await Offer.findById(id);
    if (!offer) {
      throw createAppError('NOT_FOUND', 'Offer not found');
    }

    const { name, nameEn, description, descriptionEn, bundlePrice, slots, excludedItemIds, active, startDate, endDate } = req.body;

    if (name !== undefined) offer.name = name;
    if (nameEn !== undefined) offer.nameEn = nameEn;
    if (description !== undefined) offer.description = description;
    if (descriptionEn !== undefined) offer.descriptionEn = descriptionEn;
    if (bundlePrice !== undefined) offer.bundlePrice = bundlePrice;
    if (slots !== undefined) offer.slots = slots;
    if (excludedItemIds !== undefined) offer.excludedItemIds = excludedItemIds;
    if (active !== undefined) offer.active = active;
    if (startDate !== undefined) offer.startDate = startDate || undefined;
    if (endDate !== undefined) offer.endDate = endDate || undefined;

    await offer.save();
    res.json(offer);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/offers/:id — Delete offer (admin)
router.delete('/:id', authMiddleware, requirePermission('admin:manage'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      throw createAppError('VALIDATION_ERROR', 'Invalid offer ID');
    }

    const offer = await Offer.findByIdAndDelete(id);
    if (!offer) {
      throw createAppError('NOT_FOUND', 'Offer not found');
    }

    res.json({ message: 'Offer deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
