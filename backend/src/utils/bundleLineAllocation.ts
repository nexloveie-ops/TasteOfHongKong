/** Mirror of frontend bundle allocation — order-level bundle discount spread across lines */

export type AppliedBundleLite = { discount?: number };

export interface LineLikeForBundle {
  _id: string;
  quantity: number;
  unitPrice: number;
  selectedOptions?: { extraPrice?: number }[];
  /** When set to delivery_fee, bundle discount is not allocated to this line */
  lineKind?: string;
}

export function lineGrossEuro(line: LineLikeForBundle): number {
  const opt = (line.selectedOptions || []).reduce((s, o) => s + (o.extraPrice || 0), 0);
  return (line.unitPrice + opt) * line.quantity;
}

export function bundleAdjustedLineTotals(
  items: LineLikeForBundle[],
  appliedBundles?: AppliedBundleLite[] | null,
): Map<string, number> {
  const bundleDiscount = (appliedBundles || []).reduce((s, b) => s + (b.discount ?? 0), 0);
  const out = new Map<string, number>();

  const ineligible = items.filter((i) => i.lineKind === 'delivery_fee');
  const eligible = items.filter((i) => i.lineKind !== 'delivery_fee');

  for (const item of ineligible) {
    const id = String(item._id);
    out.set(id, Math.round(lineGrossEuro(item) * 100) / 100);
  }

  const rows = eligible.map((item) => ({ id: String(item._id), gross: lineGrossEuro(item) }));
  const sumGross = rows.reduce((s, r) => s + r.gross, 0);

  if (rows.length === 0) return out;
  if (sumGross <= 0 || bundleDiscount <= 0) {
    for (const r of rows) out.set(r.id, Math.round(r.gross * 100) / 100);
    return out;
  }

  const targetNet = Math.max(0, sumGross - bundleDiscount);
  let roundedSum = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const r = rows[i];
    const rawNet = r.gross - (r.gross / sumGross) * bundleDiscount;
    const rounded = Math.round(rawNet * 100) / 100;
    out.set(r.id, rounded);
    roundedSum += rounded;
  }
  const last = rows[rows.length - 1];
  out.set(last.id, Math.round((targetNet - roundedSum) * 100) / 100);
  return out;
}
