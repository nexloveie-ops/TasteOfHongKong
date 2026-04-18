/**
 * Bundle offer matching utility.
 *
 * Given a list of cart items and active offers, finds the best combination
 * of bundles that maximizes savings.
 *
 * Key rules:
 * - Option extras (选项组加价) are NOT included in bundle matching — they are
 *   added on top of the bundle price separately.
 * - Excluded items cannot participate in a bundle.
 */

export interface OfferSlot {
  type: 'item' | 'category';
  itemId?: string;
  categoryId?: string;
}

export interface OfferData {
  _id: string;
  name: string;
  nameEn: string;
  description?: string;
  descriptionEn?: string;
  bundlePrice: number;
  slots: OfferSlot[];
  excludedItemIds?: string[];
}

export interface CartEntry {
  key: string;
  menuItemId: string;
  categoryId: string;
  /** Base price of the item (without option extras) */
  basePrice: number;
  /** Extra price from selected options */
  optionExtra: number;
  quantity: number;
}

export interface MatchedBundle {
  offer: OfferData;
  /** Keys of cart entries consumed by this bundle match */
  matchedKeys: string[];
  /** Sum of base prices of matched items (no option extras) */
  originalBasePrice: number;
  /** Sum of option extras for matched items (added on top of bundle price) */
  optionExtras: number;
  /** Bundle price */
  bundlePrice: number;
  /** Savings = originalBasePrice - bundlePrice (option extras not counted) */
  savings: number;
}

function tryMatchOffer(
  offer: OfferData,
  available: { idx: number; key: string; menuItemId: string; categoryId: string; basePrice: number; optionExtra: number }[],
): { indices: number[]; originalBasePrice: number; optionExtras: number } | null {
  const excluded = new Set(offer.excludedItemIds || []);
  const used = new Set<number>();
  const indices: number[] = [];
  let originalBasePrice = 0;
  let optionExtras = 0;

  for (const slot of offer.slots) {
    let found = false;
    for (let i = 0; i < available.length; i++) {
      if (used.has(i)) continue;
      const entry = available[i];
      // Skip excluded items
      if (excluded.has(entry.menuItemId)) continue;

      const match =
        (slot.type === 'item' && entry.menuItemId === slot.itemId) ||
        (slot.type === 'category' && entry.categoryId === slot.categoryId);

      if (match) {
        used.add(i);
        indices.push(entry.idx);
        originalBasePrice += entry.basePrice;
        optionExtras += entry.optionExtra;
        found = true;
        break;
      }
    }
    if (!found) return null;
  }

  return { indices, originalBasePrice, optionExtras };
}

/**
 * Find all applicable bundles for the given cart.
 * Greedy approach: repeatedly find the bundle with the highest savings.
 */
export function matchBundles(
  cartEntries: CartEntry[],
  offers: OfferData[],
): MatchedBundle[] {
  if (offers.length === 0 || cartEntries.length === 0) return [];

  // Expand cart entries by quantity into individual items
  const expanded: { key: string; menuItemId: string; categoryId: string; basePrice: number; optionExtra: number }[] = [];
  for (const entry of cartEntries) {
    for (let q = 0; q < entry.quantity; q++) {
      expanded.push({
        key: `${entry.key}#${q}`,
        menuItemId: entry.menuItemId,
        categoryId: entry.categoryId,
        basePrice: entry.basePrice,
        optionExtra: entry.optionExtra,
      });
    }
  }

  const results: MatchedBundle[] = [];
  const usedIndices = new Set<number>();

  let changed = true;
  while (changed) {
    changed = false;
    let bestMatch: MatchedBundle | null = null;
    let bestIndices: number[] = [];

    for (const offer of offers) {
      const available = expanded
        .map((e, idx) => ({ idx, ...e }))
        .filter(e => !usedIndices.has(e.idx));

      const result = tryMatchOffer(offer, available);
      if (result) {
        const savings = result.originalBasePrice - offer.bundlePrice;
        if (savings > 0 && (!bestMatch || savings > bestMatch.savings)) {
          bestMatch = {
            offer,
            matchedKeys: result.indices.map(i => expanded[i].key),
            originalBasePrice: result.originalBasePrice,
            optionExtras: result.optionExtras,
            bundlePrice: offer.bundlePrice,
            savings,
          };
          bestIndices = result.indices;
        }
      }
    }

    if (bestMatch) {
      results.push(bestMatch);
      for (const idx of bestIndices) usedIndices.add(idx);
      changed = true;
    }
  }

  return results;
}

/**
 * Calculate the total after applying bundles.
 * Option extras are always charged on top (not discounted by bundles).
 */
export function calcBundleTotal(
  cartEntries: CartEntry[],
  bundles: MatchedBundle[],
): { originalTotal: number; bundleDiscount: number; finalTotal: number } {
  const originalTotal = cartEntries.reduce((s, e) => s + (e.basePrice + e.optionExtra) * e.quantity, 0);
  const bundleDiscount = bundles.reduce((s, b) => s + b.savings, 0);
  return {
    originalTotal,
    bundleDiscount,
    finalTotal: originalTotal - bundleDiscount,
  };
}
