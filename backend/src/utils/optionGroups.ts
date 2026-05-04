import mongoose from 'mongoose';
import { createAppError } from '../middleware/errorHandler';

export type LeanTranslation = { locale: string; name: string };
export type LeanChoice = { _id?: mongoose.Types.ObjectId; extraPrice?: number; originalPrice?: number; translations: LeanTranslation[] };
export type LeanOptionGroup = { _id?: mongoose.Types.ObjectId; required?: boolean; translations: LeanTranslation[]; choices: LeanChoice[] };

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

export function cloneOptionGroupsWithNewIds(groups: LeanOptionGroup[]): LeanOptionGroup[] {
  return (groups || []).map((g) => ({
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
