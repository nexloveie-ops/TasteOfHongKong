import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { MenuCategory } from '../models/MenuCategory';
import { MenuItem } from '../models/MenuItem';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { createAppError } from '../middleware/errorHandler';

const router = Router();

/**
 * GET /api/menu/categories
 * Public endpoint — returns all categories sorted by sortOrder.
 * Supports optional ?lang query param to filter translations by locale.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lang = req.query.lang as string | undefined;
    const categories = await MenuCategory.find().sort({ sortOrder: 1 }).lean();

    if (lang) {
      const filtered = categories.map((cat) => {
        const translation = cat.translations.find(
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

/**
 * POST /api/menu/categories
 * Creates a new menu category. Requires auth + menu:write permission.
 */
router.post(
  '/',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
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

      const category = await MenuCategory.create({ sortOrder, translations });
      res.status(201).json(category);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/menu/categories/reorder
 * Batch update sort orders. Requires auth + menu:write permission.
 * Body: { order: [{ id: string, sortOrder: number }] }
 */
router.put(
  '/reorder',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) {
        throw createAppError('VALIDATION_ERROR', 'order must be an array');
      }
      for (const item of order) {
        if (!item.id || item.sortOrder == null) continue;
        await MenuCategory.findByIdAndUpdate(item.id, { sortOrder: item.sortOrder });
      }
      const categories = await MenuCategory.find().sort({ sortOrder: 1 }).lean();
      res.json(categories);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/menu/categories/:id
 * Updates an existing menu category. Requires auth + menu:write permission.
 */
router.put(
  '/:id',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
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

      const updated = await MenuCategory.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      });

      if (!updated) {
        throw createAppError('NOT_FOUND', 'Category not found');
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/menu/categories/:id
 * Deletes a menu category. Requires auth + menu:write permission.
 * Returns 409 CATEGORY_HAS_ITEMS if any MenuItem references this category.
 */
router.delete(
  '/:id',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createAppError('NOT_FOUND', 'Category not found');
      }

      const category = await MenuCategory.findById(id);
      if (!category) {
        throw createAppError('NOT_FOUND', 'Category not found');
      }

      const itemCount = await MenuItem.countDocuments({ categoryId: id });
      if (itemCount > 0) {
        throw createAppError('CATEGORY_HAS_ITEMS', 'Cannot delete category with associated menu items', {
          count: itemCount,
        });
      }

      await MenuCategory.findByIdAndDelete(id);
      res.json({ message: 'Category deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
