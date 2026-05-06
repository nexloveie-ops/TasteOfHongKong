import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { getModels } from '../getModels';
import { requirePermission } from '../middleware/auth';
import { requireAuthSameStore } from '../middleware/authForStore';
import { createAppError } from '../middleware/errorHandler';
import { requireFeature } from '../middleware/featureAccess';
import { FeatureKeys } from '../utils/featureCatalog';
import { normalizeNestedOptionGroups, validateOptionGroups } from '../utils/optionGroups';

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

router.get(
  '/',
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  requireFeature(FeatureKeys.AdminOptionTemplatePage),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { OptionGroupTemplate } = getModels();
      const templates = await OptionGroupTemplate.find({ storeId: req.storeId }).sort({ updatedAt: -1 }).lean();
      res.json(templates);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/',
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  requireFeature(FeatureKeys.AdminOptionTemplatePage),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { OptionGroupTemplate } = getModels();
      const { name, enabled, optionGroups } = req.body;
      if (!name || typeof name !== 'string') {
        throw createAppError('VALIDATION_ERROR', 'name is required');
      }
      const flatGroups = optionGroups === undefined ? [] : normalizeNestedOptionGroups(optionGroups);
      validateOptionGroups(flatGroups);

      const tpl = await OptionGroupTemplate.create({
        storeId: req.storeId,
        name: name.trim(),
        enabled: typeof enabled === 'boolean' ? enabled : true,
        optionGroups: flatGroups,
      });
      res.status(201).json(tpl);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/rules',
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  requireFeature(FeatureKeys.AdminOptionTemplatePage),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { OptionGroupTemplateRule } = getModels();
      const rules = await OptionGroupTemplateRule.find({ storeId: req.storeId })
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
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  requireFeature(FeatureKeys.AdminOptionTemplatePage),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { OptionGroupTemplate, OptionGroupTemplateRule } = getModels();
      const { templateId, enabled, priority, categoryIds, menuItemIds, excludedMenuItemIds } = req.body;
      if (!templateId || typeof templateId !== 'string') {
        throw createAppError('VALIDATION_ERROR', 'templateId is required');
      }
      const tid = parseObjectId(templateId, 'templateId');

      const tpl = await OptionGroupTemplate.findOne({ _id: tid, storeId: req.storeId });
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
        storeId: req.storeId,
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
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { OptionGroupTemplate, OptionGroupTemplateRule } = getModels();
      const id = req.params.id as string;
      parseObjectId(id, 'rule id');

      const existing = await OptionGroupTemplateRule.findOne({ _id: id, storeId: req.storeId });
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
        const tpl = await OptionGroupTemplate.findOne({ _id: tid, storeId: req.storeId });
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

      const ex = existing as unknown as {
        categoryIds?: mongoose.Types.ObjectId[];
        menuItemIds?: mongoose.Types.ObjectId[];
      };
      const nextCats = (update.categoryIds as mongoose.Types.ObjectId[] | undefined) ?? ex.categoryIds;
      const nextItems = (update.menuItemIds as mongoose.Types.ObjectId[] | undefined) ?? ex.menuItemIds;
      if ((!nextCats || nextCats.length === 0) && (!nextItems || nextItems.length === 0)) {
        throw createAppError('VALIDATION_ERROR', 'At least one categoryId or menuItemId is required');
      }

      const updated = await OptionGroupTemplateRule.findOneAndUpdate(
        { _id: id, storeId: req.storeId },
        update,
        { new: true, runValidators: true },
      );
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
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { OptionGroupTemplateRule } = getModels();
      const id = req.params.id as string;
      parseObjectId(id, 'rule id');

      const deleted = await OptionGroupTemplateRule.findOneAndDelete({ _id: id, storeId: req.storeId });
      if (!deleted) {
        throw createAppError('NOT_FOUND', 'Rule not found');
      }
      res.json({ message: 'Rule deleted' });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:id',
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { OptionGroupTemplate } = getModels();
      const id = req.params.id as string;
      parseObjectId(id, 'template id');
      const doc = await OptionGroupTemplate.findOne({ _id: id, storeId: req.storeId }).lean();
      if (!doc) {
        throw createAppError('NOT_FOUND', 'Template not found');
      }
      res.json(doc);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/:id',
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { OptionGroupTemplate } = getModels();
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
        const flatGroups = normalizeNestedOptionGroups(optionGroups);
        validateOptionGroups(flatGroups);
        update.optionGroups = flatGroups;
      }

      if (Object.keys(update).length === 0) {
        throw createAppError('VALIDATION_ERROR', 'No fields to update');
      }

      const updated = await OptionGroupTemplate.findOneAndUpdate(
        { _id: id, storeId: req.storeId },
        update,
        { new: true, runValidators: true },
      );
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
  ...requireAuthSameStore,
  requirePermission('menu:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { OptionGroupTemplate, OptionGroupTemplateRule } = getModels();
      const id = req.params.id as string;
      parseObjectId(id, 'template id');

      const deleted = await OptionGroupTemplate.findOneAndDelete({ _id: id, storeId: req.storeId });
      if (!deleted) {
        throw createAppError('NOT_FOUND', 'Template not found');
      }

      await OptionGroupTemplateRule.deleteMany({ templateId: new mongoose.Types.ObjectId(id), storeId: req.storeId });

      res.json({ message: 'Template deleted and related rules removed' });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
