/**
 * 检索数据库中与「销售」相关的汇总（订单 + 结账），口径与 GET /api/reports/orders、/detailed 一致：
 * - 订单：status ∈ checked_out | completed | refunded（不含 *-hide）
 * - 结账：checkouts 集合（按 checkedOutAt 可选筛选）
 *
 * 用法：
 *   cd backend && npx ts-node scripts/sales-data-overview.ts
 *   npx ts-node scripts/sales-data-overview.ts 2025-01-01 2025-12-31
 *
 * 全量导出原始文档建议在服务器上使用 mongoexport / mongodump，避免一次性灌爆终端。
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../src/db';
import { getModels } from '../src/getModels';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SALES_ORDER_STATUSES = ['checked_out', 'completed', 'refunded'] as const;

function dateRangeFromArgv(): { start?: Date; end?: Date } {
  const a = process.argv[2];
  const b = process.argv[3];
  if (!a && !b) return {};
  if (a && !b) {
    console.error('若指定日期，请同时提供开始、结束：YYYY-MM-DD YYYY-MM-DD');
    process.exit(1);
  }
  return {
    start: new Date(a + 'T00:00:00.000Z'),
    end: new Date(b + 'T23:59:59.999Z'),
  };
}

async function main(): Promise<void> {
  const { start, end } = dateRangeFromArgv();
  await connectDB();
  const { Order, Checkout, Store } = getModels();

  const orderMatch: Record<string, unknown> = {
    status: { $in: [...SALES_ORDER_STATUSES] },
  };
  if (start && end) {
    orderMatch.createdAt = { $gte: start, $lte: end };
  }

  const checkoutMatch: Record<string, unknown> = {};
  if (start && end) {
    checkoutMatch.checkedOutAt = { $gte: start, $lte: end };
  }

  const [salesOrderCount, checkoutCount, revenueAgg, ordersByStore, checkoutByStore] = await Promise.all([
    Order.countDocuments(orderMatch),
    Checkout.countDocuments(checkoutMatch),
    Checkout.aggregate([{ $match: checkoutMatch }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Order.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([
      { $match: orderMatch },
      { $group: { _id: '$storeId', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    Checkout.aggregate<{ _id: mongoose.Types.ObjectId; revenue: number; n: number }>([
      { $match: checkoutMatch },
      { $group: { _id: '$storeId', revenue: { $sum: '$totalAmount' }, n: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
    ]),
  ]);

  const storeIds = [
    ...new Set([
      ...ordersByStore.map((x) => x._id?.toString()).filter(Boolean),
      ...checkoutByStore.map((x) => x._id?.toString()).filter(Boolean),
    ]),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const stores =
    storeIds.length > 0
      ? await Store.find({ _id: { $in: storeIds } })
          .select('_id slug displayName')
          .lean()
      : [];
  const storeLabel = (id: mongoose.Types.ObjectId | null | undefined): string => {
    if (!id) return '(null)';
    const s = stores.find((st) => st._id.equals(id));
    return s ? `${(s as { slug?: string }).slug || '?'} (${(s as { displayName?: string }).displayName || ''})` : id.toString();
  };

  const period =
    start && end ? `${process.argv[2]} .. ${process.argv[3]}` : '全部时间';

  console.log('=== 销售数据概览 ===');
  console.log(`统计区间: ${period}`);
  console.log('');
  console.log(`销售口径订单数（orders）: ${salesOrderCount}`);
  console.log(`结账笔数（checkouts）:    ${checkoutCount}`);
  console.log(
    `结账金额合计（EUR）:      ${(revenueAgg[0]?.total ?? 0).toFixed(2)}`,
  );
  console.log('');
  console.log('--- 按店：销售订单条数 ---');
  for (const row of ordersByStore) {
    console.log(`  ${storeLabel(row._id)}  →  ${row.n} 条`);
  }
  console.log('');
  console.log('--- 按店：结账笔数 / 金额 ---');
  for (const row of checkoutByStore) {
    console.log(
      `  ${storeLabel(row._id)}  →  ${row.n} 笔,  €${row.revenue.toFixed(2)}`,
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
