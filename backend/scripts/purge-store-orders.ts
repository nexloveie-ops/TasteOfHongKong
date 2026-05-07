/**
 * 按店铺 slug 删除该店全部订单与结账流水，并重置日序计数器（便于本地/测试清库）。
 *
 * 用法：npx ts-node scripts/purge-store-orders.ts [slug]
 * 默认 slug：omomo
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../src/db';
import { getModels } from '../src/getModels';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main(): Promise<void> {
  const slug = (process.argv[2] || 'omomo').toLowerCase().trim();
  if (!slug) {
    console.error('请提供店铺 slug');
    process.exit(1);
  }

  await connectDB();
  const { Store, Order, Checkout, DailyOrderCounter } = getModels();

  const store = await Store.findOne({ slug });
  if (!store) {
    console.error(`未找到 slug=${slug} 的店铺`);
    process.exit(1);
  }
  const storeId = store._id as mongoose.Types.ObjectId;

  const [orders, checkouts, counters] = await Promise.all([
    Order.deleteMany({ storeId }),
    Checkout.deleteMany({ storeId }),
    DailyOrderCounter.deleteMany({ storeId }),
  ]);

  console.log(`店铺 ${slug} (${storeId}) 已清理：`);
  console.log(`  orders 删除 ${orders.deletedCount} 条`);
  console.log(`  checkouts 删除 ${checkouts.deletedCount} 条`);
  console.log(`  daily_order_counters 删除 ${counters.deletedCount} 条`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
