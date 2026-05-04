import mongoose from 'mongoose';
import { OptionGroupTemplate } from '../models/OptionGroupTemplate';
import { OptionGroupTemplateRule } from '../models/OptionGroupTemplateRule';
import { cloneOptionGroupsPreservingSubdocIds, type LeanOptionGroup } from './optionGroups';

export interface MenuItemLike {
  _id: mongoose.Types.ObjectId | string;
  categoryId: mongoose.Types.ObjectId | string;
  optionGroups?: LeanOptionGroup[];
}

function idStr(id: mongoose.Types.ObjectId | string | undefined | null): string {
  if (!id) return '';
  return typeof id === 'string' ? id : id.toString();
}

function inIdList(list: mongoose.Types.ObjectId[] | undefined, target: string): boolean {
  if (!list || list.length === 0) return false;
  return list.some((x) => idStr(x) === target);
}

export function ruleMatchesItem(
  rule: {
    categoryIds?: mongoose.Types.ObjectId[];
    menuItemIds?: mongoose.Types.ObjectId[];
    excludedMenuItemIds?: mongoose.Types.ObjectId[];
  },
  item: MenuItemLike,
): boolean {
  const itemId = idStr(item._id);
  const catId = idStr(item.categoryId);
  const excluded = inIdList(rule.excludedMenuItemIds, itemId);
  if (excluded) return false;

  const byCategory = inIdList(rule.categoryIds, catId);
  const byItem = inIdList(rule.menuItemIds, itemId);
  return byCategory || byItem;
}

export async function mergeTemplateOptionGroupsForItem(item: MenuItemLike): Promise<LeanOptionGroup[]> {
  const own = cloneOptionGroupsPreservingSubdocIds((item.optionGroups || []) as unknown as LeanOptionGroup[]);

  const rules = await OptionGroupTemplateRule.find({ enabled: true })
    .sort({ priority: 1, createdAt: 1, _id: 1 })
    .lean();

  const seenTemplateIds = new Set<string>();
  const appended: LeanOptionGroup[] = [];

  for (const rule of rules) {
    if (!ruleMatchesItem(rule, item)) continue;
    const tid = idStr(rule.templateId);
    if (!tid || seenTemplateIds.has(tid)) continue;

    const tpl = await OptionGroupTemplate.findOne({ _id: rule.templateId, enabled: true }).lean();
    if (!tpl) continue;

    const tplGroups = (tpl.optionGroups || []) as unknown as LeanOptionGroup[];
    appended.push(...cloneOptionGroupsPreservingSubdocIds(tplGroups));
    seenTemplateIds.add(tid);
  }

  return [...own, ...appended];
}

export async function mergeTemplateOptionGroupsForItems<T extends Record<string, unknown>>(items: T[]): Promise<T[]> {
  const rules = await OptionGroupTemplateRule.find({ enabled: true })
    .sort({ priority: 1, createdAt: 1, _id: 1 })
    .lean();
  const templateCache = new Map<string, LeanOptionGroup[] | null>();

  async function templateGroups(templateId: string): Promise<LeanOptionGroup[]> {
    if (templateCache.has(templateId)) {
      const c = templateCache.get(templateId);
      return c ? c : [];
    }
    if (!mongoose.Types.ObjectId.isValid(templateId)) {
      templateCache.set(templateId, null);
      return [];
    }
    const tpl = await OptionGroupTemplate.findOne({ _id: templateId, enabled: true }).lean();
    if (!tpl) {
      templateCache.set(templateId, null);
      return [];
    }
    const groups = cloneOptionGroupsPreservingSubdocIds((tpl.optionGroups || []) as unknown as LeanOptionGroup[]);
    templateCache.set(templateId, groups);
    return groups;
  }

  return Promise.all(
    items.map(async (item) => {
      const row = item as unknown as MenuItemLike;
      const own = cloneOptionGroupsPreservingSubdocIds((row.optionGroups || []) as unknown as LeanOptionGroup[]);
      const seen = new Set<string>();
      const appended: LeanOptionGroup[] = [];

      for (const r of rules) {
        if (!ruleMatchesItem(r, item as unknown as MenuItemLike)) continue;
        const tid = idStr(r.templateId);
        if (!tid || seen.has(tid)) continue;
        seen.add(tid);
        appended.push(...(await templateGroups(tid)));
      }

      return { ...item, optionGroups: [...own, ...appended] };
    }),
  );
}
