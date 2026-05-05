import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { getModels } from '../getModels';
import { requirePermission } from '../middleware/auth';
import { requireAuthSameStore } from '../middleware/authForStore';
import { createAppError } from '../middleware/errorHandler';

const router = Router();

/**
 * GET /api/menu/categories
 * Public — requires store context (X-Store-Slug / DEFAULT_STORE_SLUG).
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { MenuCategory } = getModels();
    const lang = req.query.lang as string | undefined;
    const categories = await MenuCategory.find({ storeId: req.storeId }).sort({ sortOrder: 1 }).lean();

    if (lang) {
      const filtered = (categories as { translations?: { locale: string; name: string }[] }[]).map((cat) => {
        const translation = (cat.translations || []).find(
          (t: { locale: string; name: string }) => t.locale === lang
        );
        return {
          ...cat,
          translations: translation ? [translation] : [],
        };
      });
      res.json(filtered);
    } else {
      res.json(categories);
    }
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
      const { MenuCategory } = getModels();
      const { sortOrder, translations } = req.body;

      if (sortOrder == null || !Array.isArray(translations) || translations.length === 0) {
        throw createAppError(
          'VALIDATION_ERROR',
          'sortOrder and at least one translation are required'
        );
      }

      for (const t of translations) {
        if (!t.locale || !t.name) {
          throw createAppError(
            'VALIDATION_ERROR',
            'Each translation must have locale and name'
          );
        }
      }

      const category = await MenuCategory.create({
        storeId: req.storeId,
        sortOrder,
        translations,
      });
      res.status(201).json(category);
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/reorder',
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { MenuCategory } = getModels();
      const { order } = req.body;
      if (!Array.isArray(order)) {
        throw createAppError('VALIDATION_ERROR', 'order must be an array');
      }
      for (const item of order) {
        if (!item.id || item.sortOrder == null) continue;
        await MenuCategory.findOneAndUpdate(
          { _id: item.id, storeId: req.storeId },
          { sortOrder: item.sortOrder },
        );
      }
      const categories = await MenuCategory.find({ storeId: req.storeId }).sort({ sortOrder: 1 }).lean();
      res.json(categories);
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
      const { MenuCategory } = getModels();
      const id = req.params.id as string;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('NOT_FOUND', 'Category not found');
      }

      const { sortOrder, translations } = req.body;

      if (sortOrder == null && !translations) {
        throw createAppError('VALIDATION_ERROR', 'At least sortOrder or translations must be provided');
      }

      if (translations) {
        if (!Array.isArray(translations) || translations.length === 0) {
          throw createAppError('VALIDATION_ERROR', 'translations must be a non-empty array');
        }
        for (const t of translations) {
          if (!t.locale || !t.name) {
            throw createAppError('VALIDATION_ERROR', 'Each translation must have locale and name');
          }
        }
      }

      const updateData: Record<string, unknown> = {};
      if (sortOrder != null) updateData.sortOrder = sortOrder;
      if (translations) updateData.translations = translations;

      const updated = await MenuCategory.findOneAndUpdate(
        { _id: id, storeId: req.storeId },
        updateData,
        { new: true, runValidators: true },
      );

      if (!updated) {
        throw createAppError('NOT_FOUND', 'Category not found');
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
      const { MenuCategory, MenuItem } = getModels();
      const id = req.params.id as string;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('NOT_FOUND', 'Category not found');
      }

      const category = await MenuCategory.findOne({ _id: id, storeId: req.storeId });
      if (!category) {
        throw createAppError('NOT_FOUND', 'Category not found');
      }

      const itemCount = await MenuItem.countDocuments({ categoryId: id, storeId: req.storeId });
      if (itemCount > 0) {
        throw createAppError('CATEGORY_HAS_ITEMS', 'Cannot delete category with associated menu items', {
          count: itemCount,
        });
      }

      await MenuCategory.findOneAndDelete({ _id: id, storeId: req.storeId });
      res.json({ message: 'Category deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
