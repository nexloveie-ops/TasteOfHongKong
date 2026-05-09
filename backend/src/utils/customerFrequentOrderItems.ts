import mongoose from 'mongoose';
import { expandOrderPhoneQueryVariants } from './memberWalletOps';

export type FrequentMenuItemRow = {
  menuItemId: string;
  itemName: string;
  itemNameEn: string;
  orderCount: number;
};

const MS_PER_DAY = 86400000;

/**
 * 聚合某客户近 N 天内菜品频次（本店）。先 $match 收窄订单行数，再 $project 减 I/O，最后 $unwind + $group。
 * 依赖 Order 上 (storeId, customerPhone, createdAt) 等复合索引。
 */
export async function aggregateFrequentMenuItemsForCustomer(
  Order: mongoose.Model<unknown>,
  storeId: mongoose.Types.ObjectId,
  phoneCandidates: string[],
  opts: { days: number; limit: number },
): Promise<FrequentMenuItemRow[]> {
  const matchPhones = expandOrderPhoneQueryVariants(phoneCandidates);
  if (matchPhones.length === 0) return [];

  const days = Math.min(90, Math.max(1, opts.days));
  const limit = Math.min(20, Math.max(1, opts.limit));
  const since = new Date(Date.now() - days * MS_PER_DAY);

  const rows = await Order.aggregate<FrequentMenuItemRow>([
    {
      $match: {
        storeId,
        createdAt: { $gte: since },
        status: { $ne: 'refunded' },
        $or: [{ customerPhone: { $in: matchPhones } }, { memberPhoneSnapshot: { $in: matchPhones } }],
      },
    },
    { $project: { items: 1, createdAt: 1 } },
    { $unwind: '$items' },
    {
      $match: {
        'items.lineKind': { $ne: 'delivery_fee' },
        'items.refunded': { $ne: true },
        'items.menuItemId': { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: '$items.menuItemId',
        orderCount: { $sum: '$items.quantity' },
        itemName: { $first: '$items.itemName' },
        itemNameEn: { $first: '$items.itemNameEn' },
        lastAt: { $max: '$createdAt' },
      },
    },
    { $sort: { orderCount: -1, lastAt: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        menuItemId: { $toString: '$_id' },
        itemName: 1,
        itemNameEn: { $ifNull: ['$itemNameEn', ''] },
        orderCount: 1,
      },
    },
  ]).option({ allowDiskUse: true });

  return rows;
}
