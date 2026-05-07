type OrderLineLike = {
  lineKind?: string;
  refunded?: boolean;
  unitPrice: number;
  quantity: number;
  itemName?: string;
  itemNameEn?: string;
  selectedOptions?: { extraPrice?: number }[];
};

function numEuro(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (v != null && typeof (v as { toString?: () => string }).toString === 'function') {
    const n = Number(String(v));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isDeliveryFeeMenuLabel(item: OrderLineLike): boolean {
  const zh = String(item.itemName || '').replace(/\s/g, '');
  const en = String(item.itemNameEn || '')
    .trim()
    .toLowerCase();
  return zh === '送餐费' || zh === '送餐費' || en === 'delivery fee';
}

/** 非退款菜品行小计（排除运费行：lineKind、或名称像送餐费），含选项加价 */
export function rawFoodSubtotalExcludingDeliveryFeeEuro(order: { items?: OrderLineLike[] }): number {
  let s = 0;
  for (const item of order.items ?? []) {
    if (item.refunded) continue;
    if (item.lineKind === 'delivery_fee') continue;
    if (isDeliveryFeeMenuLabel(item)) continue;
    const opt = (item.selectedOptions || []).reduce((o, x) => o + (x.extraPrice || 0), 0);
    s += (item.unitPrice + opt) * item.quantity;
  }
  return Math.round(s * 100) / 100;
}

/**
 * Payable total in euros for Stripe / seat checkout, including delivery fee lines
 * and legacy order.deliveryFeeEuro when there is no delivery_fee line item.
 */
export function computeOrderPayableTotalEuro(order: {
  type?: string;
  items?: { unitPrice: number; quantity: number; lineKind?: string; selectedOptions?: { extraPrice?: number }[] }[];
  appliedBundles?: { discount: number }[];
  deliveryFeeEuro?: number;
}): number {
  const lines = order.items ?? [];
  const itemTotal = lines.reduce((sum, item) => {
    const optExtra = (item.selectedOptions || []).reduce((s, o) => s + (o.extraPrice || 0), 0);
    return sum + (item.unitPrice + optExtra) * item.quantity;
  }, 0);
  const bundleDiscount = (order.appliedBundles || []).reduce((s, b) => s + b.discount, 0);
  const hasDeliveryFeeLine = lines.some((i) => i.lineKind === 'delivery_fee');
  const deliveryLegacy =
    order.type === 'delivery' && !hasDeliveryFeeLine ? numEuro(order.deliveryFeeEuro) : 0;
  return Math.round((itemTotal - bundleDiscount + deliveryLegacy) * 100) / 100;
}

/**
 * 送餐费金额：优先 `delivery_fee` 行、名称「送餐费」行、订单字段 `deliveryFeeEuro`；
 * 若仍为 0，用 **应付总额 − 菜品小计 + Bundle** 反推（与 computeOrderPayableTotalEuro 自洽，避免 lineKind 未写入时报表运费为 0）。
 */
export function deliveryFeePortionEuro(order: {
  type?: string;
  items?: OrderLineLike[];
  appliedBundles?: { discount: number }[];
  deliveryFeeEuro?: number;
}): number {
  if (order.type !== 'delivery') return 0;

  const items = order.items ?? [];
  let fromKind = 0;
  for (const item of items) {
    if (item.lineKind !== 'delivery_fee' || item.refunded) continue;
    const opt = (item.selectedOptions || []).reduce((s, o) => s + (o.extraPrice || 0), 0);
    fromKind += (item.unitPrice + opt) * item.quantity;
  }
  if (fromKind > 0) return Math.round(fromKind * 100) / 100;

  let fromName = 0;
  for (const item of items) {
    if (item.refunded) continue;
    if (item.lineKind === 'delivery_fee') continue;
    if (!isDeliveryFeeMenuLabel(item)) continue;
    const opt = (item.selectedOptions || []).reduce((s, o) => s + (o.extraPrice || 0), 0);
    fromName += (item.unitPrice + opt) * item.quantity;
  }
  if (fromName > 0) return Math.round(fromName * 100) / 100;

  const fieldFee = numEuro(order.deliveryFeeEuro);
  if (fieldFee > 0) return Math.round(fieldFee * 100) / 100;

  const bundleDiscount = (order.appliedBundles || []).reduce((s, b) => s + numEuro(b.discount), 0);
  const payable = computeOrderPayableTotalEuro(order);
  const rawFood = rawFoodSubtotalExcludingDeliveryFeeEuro(order);
  const derived = payable - rawFood + bundleDiscount;
  return Math.max(0, Math.round(derived * 100) / 100);
}

/** 送餐单「菜品+选项」侧合计：行项目应付总额减去送餐费（未用结账实收，无 checkout 时可用） */
export function computeOrderGoodsTotalExcludingDeliveryFeeEuro(
  order: Parameters<typeof computeOrderPayableTotalEuro>[0],
): number {
  return Math.round((computeOrderPayableTotalEuro(order) - deliveryFeePortionEuro(order)) * 100) / 100;
}

/**
 * 营业报表「送餐订单合集」：单笔 **结账总金额**（与 checkout.totalAmount 一致，含券后实收）减去送餐费。
 * 无 `recordedTotalEuro` 时回退为行项目应付总额。
 */
export function deliveryOrderGoodsTotalFromCheckoutEuro(
  order: Parameters<typeof computeOrderPayableTotalEuro>[0],
  recordedTotalEuro?: number | null,
): number {
  const grand =
    recordedTotalEuro != null && Number.isFinite(recordedTotalEuro) && recordedTotalEuro >= 0
      ? recordedTotalEuro
      : computeOrderPayableTotalEuro(order);
  const fee = deliveryFeePortionEuro(order);
  return Math.max(0, Math.round((grand - fee) * 100) / 100);
}
