import mongoose from 'mongoose';
import { Order } from '../models/Order';
import { Checkout } from '../models/Checkout';
import { MenuItem } from '../models/MenuItem';
import { MenuCategory } from '../models/MenuCategory';
import { SystemConfig } from '../models/SystemConfig';
import { bundleAdjustedLineTotals, lineGrossEuro, type LineLikeForBundle } from './bundleLineAllocation';

export const FOOD_VAT_RATE = 0.135;
export const DRINK_VAT_RATE = 0.23;

export type MonthSalesBuckets = { foodGross: number; drinkGross: number };

export function irelandMonthKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit' }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}`;
}

export function isDrinkCategory(cat: { translations?: { name?: string }[] } | null | undefined): boolean {
  if (!cat?.translations) return false;
  for (const t of cat.translations) {
    const n = (t.name || '').toLowerCase();
    if (n.includes('drink') || n.includes('饮料')) return true;
  }
  return false;
}

export interface StoreInfoForVat {
  accountNumber: string;
  storeAddress: string;
  storeName: string;
  storePhone: string;
}

export async function loadStoreInfoForVat(): Promise<StoreInfoForVat> {
  const keys = [
    'account_number',
    'restaurant_name_en',
    'restaurant_address_en',
    'restaurant_address',
    'restaurant_phone',
  ];
  const rows = await SystemConfig.find({ key: { $in: keys } }).lean();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  const address = (map.restaurant_address_en || map.restaurant_address || '').trim();
  return {
    accountNumber: map.account_number || '',
    storeName: (map.restaurant_name_en || '').trim(),
    storeAddress: address,
    storePhone: map.restaurant_phone || '',
  };
}

/** Same idea as detailed stats: hide-flag orders are excluded from revenue reports. */
function isHiddenOrderStatus(status: unknown): boolean {
  return String(status ?? '').includes('-hide');
}

function itemToLineLike(item: {
  _id: unknown;
  quantity: number;
  unitPrice: number;
  selectedOptions?: { extraPrice?: number }[];
}): LineLikeForBundle {
  return {
    _id: String(item._id),
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    selectedOptions: item.selectedOptions as { extraPrice?: number }[] | undefined,
  };
}

/**
 * Aggregate VAT-inclusive gross sales by Ireland calendar month (Europe/Dublin).
 * Amounts match checkout totals (bundle + coupon scaling per checkout).
 */
export async function aggregateVatSalesByMonth(
  startDate: string,
  endDate: string,
): Promise<{ byMonth: Map<string, MonthSalesBuckets>; storeInfo: StoreInfoForVat }> {
  const start = new Date(startDate + 'T00:00:00.000Z');
  const end = new Date(endDate + 'T23:59:59.999Z');

  const checkouts = await Checkout.find({
    checkedOutAt: { $gte: start, $lte: end },
  }).lean();

  const storeInfo = await loadStoreInfoForVat();
  const byMonth = new Map<string, MonthSalesBuckets>();

  if (checkouts.length === 0) {
    return { byMonth, storeInfo };
  }

  const rawOrderIds = [...new Set(checkouts.flatMap((c) => (c.orderIds || []).map((id) => id.toString())))];
  const orderIds = rawOrderIds.filter((id) => mongoose.isValidObjectId(id));
  const orders =
    orderIds.length > 0
      ? await Order.find({
          _id: { $in: orderIds.map((id) => new mongoose.Types.ObjectId(id)) },
        }).lean()
      : [];

  const rawMenuIds = orders.flatMap((o) =>
    o.items.map((i) => (i as { menuItemId: unknown }).menuItemId?.toString()).filter(Boolean),
  ) as string[];
  const allMenuItemIds = [...new Set(rawMenuIds.filter((id) => mongoose.isValidObjectId(id)))];
  const menuItems =
    allMenuItemIds.length > 0
      ? await MenuItem.find({
          _id: { $in: allMenuItemIds.map((id) => new mongoose.Types.ObjectId(id)) },
        }).lean()
      : [];
  const menuMap = new Map(menuItems.map((m) => [m._id.toString(), m]));

  const catIds = [
    ...new Set(
      menuItems
        .map((m) => (m.categoryId ? m.categoryId.toString() : null))
        .filter((id): id is string => Boolean(id && mongoose.isValidObjectId(id))),
    ),
  ];
  const categories =
    catIds.length > 0
      ? await MenuCategory.find({ _id: { $in: catIds.map((id) => new mongoose.Types.ObjectId(id)) } }).lean()
      : [];
  const catMap = new Map(categories.map((c) => [c._id.toString(), c]));

  const orderById = new Map(orders.map((o) => [o._id.toString(), o]));

  function bump(monthKey: string, drink: boolean, delta: number) {
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, { foodGross: 0, drinkGross: 0 });
    const b = byMonth.get(monthKey)!;
    if (drink) b.drinkGross += delta;
    else b.foodGross += delta;
  }

  for (const c of checkouts) {
    const ordersHere = (c.orderIds || [])
      .map((oid) => orderById.get(oid.toString()))
      .filter((o): o is (typeof orders)[0] => !!o);

    if (ordersHere.length === 0) continue;

    const monthKey = irelandMonthKey(new Date(c.checkedOutAt || Date.now()));

    type BundleDoc = { discount: number }[];
    let grandSum = 0;
    const perOrderMaps: { order: (typeof orders)[0]; map: Map<string, number> }[] = [];
    for (const order of ordersHere) {
      const applied = (order as unknown as { appliedBundles?: BundleDoc }).appliedBundles;
      const items = order.items.map((it) => itemToLineLike(it as Parameters<typeof itemToLineLike>[0]));
      const m = bundleAdjustedLineTotals(items, applied);
      perOrderMaps.push({ order, map: m });
      for (const v of m.values()) grandSum += v;
    }

    const scale = grandSum > 0 ? c.totalAmount / grandSum : 0;

    for (const { order, map } of perOrderMaps) {
      if (isHiddenOrderStatus(order.status)) continue;
      for (const item of order.items) {
        const id = String((item as { _id: { toString(): string } })._id);
        const raw = map.get(id) ?? lineGrossEuro(itemToLineLike(item as Parameters<typeof itemToLineLike>[0]));
        const amt = Math.round(raw * scale * 100) / 100;
        const signed = (item as { refunded?: boolean }).refunded ? -amt : amt;
        if (Math.abs(signed) < 1e-9) continue;
        const mid = (item as { menuItemId?: unknown }).menuItemId?.toString();
        const mi = mid ? menuMap.get(mid) : undefined;
        const cat = mi?.categoryId ? catMap.get(mi.categoryId.toString()) : undefined;
        const drink = isDrinkCategory(cat);
        bump(monthKey, drink, signed);
      }
    }
  }

  return { byMonth, storeInfo };
}
