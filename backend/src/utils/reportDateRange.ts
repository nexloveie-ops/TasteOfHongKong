/**
 * Order `createdAt` range for GET /api/reports/* — must match
 * `aggregateVatSalesByMonth` in `vatReportAggregation.ts` (UTC inclusive days).
 * Mongo stores UTC; using explicit Z avoids server-local drift vs VAT PDF export.
 */
export function orderCreatedAtRangeUtc(startDate: string, endDate: string): { $gte: Date; $lte: Date } {
  return {
    $gte: new Date(`${startDate}T00:00:00.000Z`),
    $lte: new Date(`${endDate}T23:59:59.999Z`),
  };
}

/** Optional start/end for Order.createdAt — same UTC semantics as VAT worksheet. */
export function orderCreatedAtFilterUtc(startDate?: string, endDate?: string): Record<string, Date> | undefined {
  if (!startDate && !endDate) return undefined;
  const out: Record<string, Date> = {};
  if (startDate) out.$gte = new Date(`${startDate}T00:00:00.000Z`);
  if (endDate) out.$lte = new Date(`${endDate}T23:59:59.999Z`);
  return out;
}

/** Checkout.checkedOutAt range — UTC calendar days (align with order reports when comparing). */
export function checkoutCheckedOutFilterUtc(startDate?: string, endDate?: string): Record<string, Date> | undefined {
  if (!startDate && !endDate) return undefined;
  const out: Record<string, Date> = {};
  if (startDate) out.$gte = new Date(`${startDate}T00:00:00.000Z`);
  if (endDate) out.$lte = new Date(`${endDate}T23:59:59.999Z`);
  return out;
}
