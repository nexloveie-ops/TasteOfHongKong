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
    order.type === 'delivery' && !hasDeliveryFeeLine ? Number(order.deliveryFeeEuro) || 0 : 0;
  return Math.round((itemTotal - bundleDiscount + deliveryLegacy) * 100) / 100;
}
