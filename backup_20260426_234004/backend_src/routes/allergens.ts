import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Allergen } from '../models/Allergen';
import { MenuItem } from '../models/MenuItem';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { createAppError } from '../middleware/errorHandler';

const router = Router();

/**
 * GET /api/allergens
 * Public endpoint — returns all allergens.
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const allergens = await Allergen.find().lean();
    res.json(allergens);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/allergens
 * Creates a new allergen. Requires auth + menu:write permission.
 */
router.post(
  '/',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, icon, translations } = req.body;

      if (!name) {
        throw createAppError('VALIDATION_ERROR', 'name is required');
      }

      const allergen = await Allergen.create({ name, icon, translations: translations || [] });
      res.status(201).json(allergen);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/allergens/:id
 * Updates an existing allergen. Requires auth + menu:write permission.
 */
router.put(
  '/:id',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('NOT_FOUND', 'Allergen not found');
      }

      const { name, icon, translations } = req.body;

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (icon !== undefined) updateData.icon = icon;
      if (translations !== undefined) updateData.translations = translations;

      if (Object.keys(updateData).length === 0) {
        throw createAppError('VALIDATION_ERROR', 'At least one field must be provided for update');
      }

      const updated = await Allergen.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      });

      if (!updated) {
        throw createAppError('NOT_FOUND', 'Allergen not found');
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/allergens/:id
 * Deletes an allergen. Requires auth + menu:write permission.
 * Returns 409 if any MenuItem references it.
 */
router.delete(
  '/:id',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('NOT_FOUND', 'Allergen not found');
      }

      const allergen = await Allergen.findById(id);
      if (!allergen) {
        throw createAppError('NOT_FOUND', 'Allergen not found');
      }

      const itemCount = await MenuItem.countDocuments({ allergenIds: id });
      if (itemCount > 0) {
        throw createAppError('CONFLICT', 'This allergen is in use by menu items and cannot be deleted', {
          count: itemCount,
        });
      }

      await Allergen.findByIdAndDelete(id);
      res.json({ message: 'Allergen deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
