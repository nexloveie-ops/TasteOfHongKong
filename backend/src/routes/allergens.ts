import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { getModels } from '../getModels';
import { requirePermission } from '../middleware/auth';
import { requireAuthSameStore } from '../middleware/authForStore';
import { createAppError } from '../middleware/errorHandler';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Allergen } = getModels();
    const allergens = await Allergen.find({ storeId: req.storeId }).lean();
    res.json(allergens);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Allergen } = getModels();
      const { name, icon, translations } = req.body;

      if (!name) {
        throw createAppError('VALIDATION_ERROR', 'name is required');
      }

      const allergen = await Allergen.create({
        storeId: req.storeId,
        name,
        icon,
        translations: translations || [],
      });
      res.status(201).json(allergen);
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id',
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Allergen } = getModels();
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

      const updated = await Allergen.findOneAndUpdate({ _id: id, storeId: req.storeId }, updateData, {
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

router.delete(
  '/:id',
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { Allergen, MenuItem } = getModels();
      const id = req.params.id as string;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('NOT_FOUND', 'Allergen not found');
      }

      const allergen = await Allergen.findOne({ _id: id, storeId: req.storeId });
      if (!allergen) {
        throw createAppError('NOT_FOUND', 'Allergen not found');
      }

      const itemCount = await MenuItem.countDocuments({ storeId: req.storeId, allergenIds: id });
      if (itemCount > 0) {
        throw createAppError('CONFLICT', 'This allergen is in use by menu items and cannot be deleted', {
          count: itemCount,
        });
      }

      await Allergen.findOneAndDelete({ _id: id, storeId: req.storeId });
      res.json({ message: 'Allergen deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
