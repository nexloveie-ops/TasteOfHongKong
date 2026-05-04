/** Mirror of frontend bundle allocation — order-level bundle discount spread across lines */

export type AppliedBundleLite = { discount?: number };

export interface LineLikeForBundle {
  _id: string;
  quantity: number;
  unitPrice: number;
  selectedOptions?: { extraPrice?: number }[];
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
  const rows = items.map((item) => ({ id: String(item._id), gross: lineGrossEuro(item) }));
  const sumGross = rows.reduce((s, r) => s + r.gross, 0);
  const out = new Map<string, number>();

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
