import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { OptionGroupTemplate } from '../models/OptionGroupTemplate';
import { OptionGroupTemplateRule } from '../models/OptionGroupTemplateRule';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { createAppError } from '../middleware/errorHandler';
import { validateOptionGroups } from '../utils/optionGroups';

const router = Router();

function parseObjectId(id: string, label: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw createAppError('VALIDATION_ERROR', `Invalid ${label}`);
  }
  return new mongoose.Types.ObjectId(id);
}

function parseObjectIdArray(arr: unknown, label: string): mongoose.Types.ObjectId[] {
  if (arr === undefined) return [];
  if (!Array.isArray(arr)) {
    throw createAppError('VALIDATION_ERROR', `${label} must be an array`);
  }
  return arr.map((x, idx) => {
    if (typeof x !== 'string' || !mongoose.Types.ObjectId.isValid(x)) {
      throw createAppError('VALIDATION_ERROR', `Invalid ${label}[${idx}]`);
    }
    return new mongoose.Types.ObjectId(x);
  });
}

// --- Templates ---

router.get(
  '/',
  authMiddleware,
  requirePermission('menu:write'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const templates = await OptionGroupTemplate.find({}).sort({ updatedAt: -1 }).lean();
      res.json(templates);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, enabled, optionGroups } = req.body;
      if (!name || typeof name !== 'string') {
        throw createAppError('VALIDATION_ERROR', 'name is required');
      }
      validateOptionGroups(optionGroups);

      const tpl = await OptionGroupTemplate.create({
        name: name.trim(),
        enabled: typeof enabled === 'boolean' ? enabled : true,
        optionGroups: optionGroups || [],
      });
      res.status(201).json(tpl);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/:id',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      parseObjectId(id, 'template id');

      const { name, enabled, optionGroups } = req.body;
      const update: Record<string, unknown> = {};
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          throw createAppError('VALIDATION_ERROR', 'name must be a non-empty string');
        }
        update.name = name.trim();
      }
      if (enabled !== undefined) {
        if (typeof enabled !== 'boolean') {
          throw createAppError('VALIDATION_ERROR', 'enabled must be a boolean');
        }
        update.enabled = enabled;
      }
      if (optionGroups !== undefined) {
        validateOptionGroups(optionGroups);
        update.optionGroups = optionGroups;
      }

      if (Object.keys(update).length === 0) {
        throw createAppError('VALIDATION_ERROR', 'No fields to update');
      }

      const updated = await OptionGroupTemplate.findByIdAndUpdate(id, update, { new: true, runValidators: true });
      if (!updated) {
        throw createAppError('NOT_FOUND', 'Template not found');
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/:id',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      parseObjectId(id, 'template id');

      const deleted = await OptionGroupTemplate.findByIdAndDelete(id);
      if (!deleted) {
        throw createAppError('NOT_FOUND', 'Template not found');
      }

      await OptionGroupTemplateRule.deleteMany({ templateId: id });

      res.json({ message: 'Template deleted and related rules removed' });
    } catch (err) {
      next(err);
    }
  },
);

// --- Rules ---

router.get(
  '/rules',
  authMiddleware,
  requirePermission('menu:write'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rules = await OptionGroupTemplateRule.find({})
        .sort({ priority: 1, createdAt: 1, _id: 1 })
        .lean();
      res.json(rules);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/rules',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { templateId, enabled, priority, categoryIds, menuItemIds, excludedMenuItemIds } = req.body;
      if (!templateId || typeof templateId !== 'string') {
        throw createAppError('VALIDATION_ERROR', 'templateId is required');
      }
      const tid = parseObjectId(templateId, 'templateId');

      const tpl = await OptionGroupTemplate.findById(tid);
      if (!tpl) {
        throw createAppError('VALIDATION_ERROR', 'Template not found');
      }

      const cats = parseObjectIdArray(categoryIds, 'categoryIds');
      const items = parseObjectIdArray(menuItemIds, 'menuItemIds');
      const excluded = parseObjectIdArray(excludedMenuItemIds, 'excludedMenuItemIds');

      if (cats.length === 0 && items.length === 0) {
        throw createAppError('VALIDATION_ERROR', 'At least one categoryId or menuItemId is required');
      }

      const rule = await OptionGroupTemplateRule.create({
        templateId: tid,
        enabled: typeof enabled === 'boolean' ? enabled : true,
        priority: typeof priority === 'number' && Number.isFinite(priority) ? priority : 100,
        categoryIds: cats,
        menuItemIds: items,
        excludedMenuItemIds: excluded,
      });

      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/rules/:id',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      parseObjectId(id, 'rule id');

      const existing = await OptionGroupTemplateRule.findById(id);
      if (!existing) {
        throw createAppError('NOT_FOUND', 'Rule not found');
      }

      const { templateId, enabled, priority, categoryIds, menuItemIds, excludedMenuItemIds } = req.body;
      const update: Record<string, unknown> = {};

      if (templateId !== undefined) {
        if (typeof templateId !== 'string') {
          throw createAppError('VALIDATION_ERROR', 'templateId must be a string');
        }
        const tid = parseObjectId(templateId, 'templateId');
        const tpl = await OptionGroupTemplate.findById(tid);
        if (!tpl) {
          throw createAppError('VALIDATION_ERROR', 'Template not found');
        }
        update.templateId = tid;
      }

      if (enabled !== undefined) {
        if (typeof enabled !== 'boolean') {
          throw createAppError('VALIDATION_ERROR', 'enabled must be a boolean');
        }
        update.enabled = enabled;
      }

      if (priority !== undefined) {
        if (typeof priority !== 'number' || !Number.isFinite(priority)) {
          throw createAppError('VALIDATION_ERROR', 'priority must be a number');
        }
        update.priority = priority;
      }

      if (categoryIds !== undefined) {
        update.categoryIds = parseObjectIdArray(categoryIds, 'categoryIds');
      }
      if (menuItemIds !== undefined) {
        update.menuItemIds = parseObjectIdArray(menuItemIds, 'menuItemIds');
      }
      if (excludedMenuItemIds !== undefined) {
        update.excludedMenuItemIds = parseObjectIdArray(excludedMenuItemIds, 'excludedMenuItemIds');
      }

      if (Object.keys(update).length === 0) {
        throw createAppError('VALIDATION_ERROR', 'No fields to update');
      }

      const nextCats =
        (update.categoryIds as mongoose.Types.ObjectId[] | undefined) ?? existing.categoryIds;
      const nextItems =
        (update.menuItemIds as mongoose.Types.ObjectId[] | undefined) ?? existing.menuItemIds;
      if ((!nextCats || nextCats.length === 0) && (!nextItems || nextItems.length === 0)) {
        throw createAppError('VALIDATION_ERROR', 'At least one categoryId or menuItemId is required');
      }

      const updated = await OptionGroupTemplateRule.findByIdAndUpdate(id, update, { new: true, runValidators: true });
      if (!updated) {
        throw createAppError('NOT_FOUND', 'Rule not found');
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/rules/:id',
  authMiddleware,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      parseObjectId(id, 'rule id');

      const deleted = await OptionGroupTemplateRule.findByIdAndDelete(id);
      if (!deleted) {
        throw createAppError('NOT_FOUND', 'Rule not found');
      }
      res.json({ message: 'Rule deleted' });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
