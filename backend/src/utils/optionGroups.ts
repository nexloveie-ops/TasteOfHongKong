import mongoose from 'mongoose';
import { createAppError } from '../middleware/errorHandler';

export type LeanTranslation = { locale: string; name: string };
export type LeanChoice = { _id?: mongoose.Types.ObjectId; extraPrice?: number; originalPrice?: number; translations: LeanTranslation[] };
export type LeanOptionGroup = { _id?: mongoose.Types.ObjectId; required?: boolean; translations: LeanTranslation[]; choices: LeanChoice[] };

function isGroupLikeRecord(x: unknown): boolean {
  return (
    x != null &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    ('translations' in (x as object) || 'choices' in (x as object) || 'required' in (x as object))
  );
}

/** Flatten mistaken [[{...}]] storage to [{...}] so clone/validation see real groups. */
export function normalizeNestedOptionGroups(raw: unknown): LeanOptionGroup[] {
  if (!Array.isArray(raw)) return [];
  function unwrap(rs: unknown[]): LeanOptionGroup[] {
    const out: LeanOptionGroup[] = [];
    for (const row of rs) {
      if (!Array.isArray(row)) {
        if (isGroupLikeRecord(row)) out.push(row as LeanOptionGroup);
        continue;
      }
      if (row.length === 0) continue;
      if (row.every((x) => isGroupLikeRecord(x))) {
        out.push(...(row as LeanOptionGroup[]));
        continue;
      }
      out.push(...unwrap(row as unknown[]));
    }
    return out;
  }
  return unwrap(raw);
}

function assertTranslationArray(translations: unknown, label: string): translations is LeanTranslation[] {
  if (!Array.isArray(translations) || translations.length === 0) {
    throw createAppError('VALIDATION_ERROR', `${label}: translations must be a non-empty array`);
  }
  for (const t of translations) {
    if (!t || typeof t !== 'object') {
      throw createAppError('VALIDATION_ERROR', `${label}: invalid translation entry`);
    }
    const tr = t as { locale?: string; name?: string };
    if (!tr.locale || !tr.name) {
      throw createAppError('VALIDATION_ERROR', `${label}: each translation must have locale and name`);
    }
  }
  return true;
}

export function validateOptionGroups(optionGroups: unknown): asserts optionGroups is LeanOptionGroup[] {
  if (optionGroups === undefined) return;
  if (!Array.isArray(optionGroups)) {
    throw createAppError('VALIDATION_ERROR', 'optionGroups must be an array');
  }
  for (let gi = 0; gi < optionGroups.length; gi++) {
    const g = optionGroups[gi] as LeanOptionGroup;
    if (!g || typeof g !== 'object') {
      throw createAppError('VALIDATION_ERROR', `optionGroups[${gi}] is invalid`);
    }
    assertTranslationArray(g.translations, `optionGroups[${gi}]`);
    if (!Array.isArray(g.choices) || g.choices.length === 0) {
      throw createAppError('VALIDATION_ERROR', `optionGroups[${gi}]: choices must be a non-empty array`);
    }
    for (let ci = 0; ci < g.choices.length; ci++) {
      const c = g.choices[ci];
      if (!c || typeof c !== 'object') {
        throw createAppError('VALIDATION_ERROR', `optionGroups[${gi}].choices[${ci}] is invalid`);
      }
      assertTranslationArray(c.translations, `optionGroups[${gi}].choices[${ci}]`);
      if (c.extraPrice != null && typeof c.extraPrice !== 'number') {
        throw createAppError('VALIDATION_ERROR', `optionGroups[${gi}].choices[${ci}]: extraPrice must be a number`);
      }
      if (c.originalPrice != null && typeof c.originalPrice !== 'number') {
        throw createAppError('VALIDATION_ERROR', `optionGroups[${gi}].choices[${ci}]: originalPrice must be a number`);
      }
    }
  }
}

function subdocObjectId(id: unknown): mongoose.Types.ObjectId {
  if (id != null && mongoose.Types.ObjectId.isValid(String(id))) {
    return new mongoose.Types.ObjectId(String(id));
  }
  return new mongoose.Types.ObjectId();
}

/**
 * Clone option groups for merged menu + order validation: keep MongoDB subdocument `_id`s so
 * `/api/menu/items` and `snapshotSelectedOptionsFromMenuItem` agree even when template rules or
 * group ordering changes. Index-based synthetic IDs were unstable and caused "Unknown option group".
 */
export function cloneOptionGroupsPreservingSubdocIds(groups: LeanOptionGroup[]): LeanOptionGroup[] {
  const flat = normalizeNestedOptionGroups(groups);
  return flat.map((g) => ({
    _id: subdocObjectId(g._id),
    required: !!g.required,
    translations: (g.translations || []).map((t) => ({ locale: t.locale, name: t.name })),
    choices: (g.choices || []).map((c) => ({
      _id: subdocObjectId(c._id),
      extraPrice: typeof c.extraPrice === 'number' ? c.extraPrice : 0,
      originalPrice: c.originalPrice,
      translations: (c.translations || []).map((t) => ({ locale: t.locale, name: t.name })),
    })),
  }));
}

/** @deprecated Prefer cloneOptionGroupsPreservingSubdocIds for merged menus. */
export function cloneOptionGroupsWithNewIds(groups: LeanOptionGroup[]): LeanOptionGroup[] {
  const flat = normalizeNestedOptionGroups(groups);
  return flat.map((g) => ({
    _id: new mongoose.Types.ObjectId(),
    required: !!g.required,
    translations: (g.translations || []).map((t) => ({ locale: t.locale, name: t.name })),
    choices: (g.choices || []).map((c) => ({
      _id: new mongoose.Types.ObjectId(),
      extraPrice: typeof c.extraPrice === 'number' ? c.extraPrice : 0,
      originalPrice: c.originalPrice,
      translations: (c.translations || []).map((t) => ({ locale: t.locale, name: t.name })),
    })),
  }));
}
