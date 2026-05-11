/**
 * 将「单店」MongoDB 中的 orders / checkouts 导入多店库下指定店铺（注入 storeId，并重映射订单 ID）。
 *
 * 不要在代码或 Git 中写入源库密码；使用环境变量：
 *   SOURCE_MONGODB_URI — 源连接串（可用 Atlas URI）
 *   SOURCE_DB_NAME      — 可选；若 URI 未含库名，必须指定（否则会连到默认库，常为 test）
 *
 * 目标库读取 backend/.env 的 LZFOOD_DBCON 或 DBCON；目标店铺：
 *   IMPORT_TARGET_SLUG  — 默认 tasteofhongkong
 *
 * 用法：
 *   cd backend
 *   SOURCE_MONGODB_URI="..." SOURCE_DB_NAME="你的单店库名" npx ts-node scripts/import-legacy-store-orders.ts --dry-run
 *   SOURCE_MONGODB_URI="..." SOURCE_DB_NAME="..." npx ts-node scripts/import-legacy-store-orders.ts --import
 *
 * --dry-run   只连接、计数、打印首条样本字段与映射说明，不写目标库
 * --import    执行写入（建议导入前先备份目标库；可与 purge-store-orders 清空该店订单后再导）
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../src/db';
import { getModels } from '../src/getModels';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TARGET_SLUG = (process.env.IMPORT_TARGET_SLUG || 'tasteofhongkong').toLowerCase().trim();

function omitUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function parseArgs(): { dryRun: boolean; doImport: boolean } {
  const dryRun = process.argv.includes('--dry-run');
  const doImport = process.argv.includes('--import');
  if (!dryRun && !doImport) {
    console.error('请指定 --dry-run 或 --import');
    process.exit(1);
  }
  return { dryRun, doImport };
}

/** 单店订单 → 多店订单文档（新生成 _id，去掉会员等跨库无效引用） */
function mapLegacyOrder(
  raw: Record<string, unknown>,
  storeId: mongoose.Types.ObjectId,
): { newDoc: Record<string, unknown>; oldId: string } {
  const oldId = String(raw._id);
  const newId = new mongoose.Types.ObjectId();

  const items = Array.isArray(raw.items)
    ? raw.items.map((line: unknown) => mapOrderLine(line as Record<string, unknown>))
    : [];

  const typeRaw = String(raw.type ?? 'dine_in');
  const type = ['dine_in', 'takeout', 'phone', 'delivery'].includes(typeRaw) ? typeRaw : 'dine_in';

  const statusRaw = String(raw.status ?? 'pending');
  const allowedStatus = [
    'pending',
    'paid_online',
    'checked_out',
    'completed',
    'refunded',
    'checked_out-hide',
    'completed-hide',
  ];
  const status = allowedStatus.includes(statusRaw) ? statusRaw : 'checked_out';

  const newDoc: Record<string, unknown> = {
    _id: newId,
    storeId,
    type,
    tableNumber: raw.tableNumber,
    seatNumber: raw.seatNumber,
    dailyOrderNumber: raw.dailyOrderNumber,
    dineInOrderNumber: raw.dineInOrderNumber,
    customerName: raw.customerName ?? '',
    customerPhone: raw.customerPhone ?? '',
    deliveryAddress: raw.deliveryAddress ?? '',
    postalCode: raw.postalCode ?? '',
    deliverySource:
      raw.deliverySource === 'phone' || raw.deliverySource === 'qr' ? raw.deliverySource : undefined,
    deliveryStage: (() => {
      const ds = String(raw.deliveryStage ?? 'new');
      return ['new', 'accepted', 'picked_up_by_driver', 'out_for_delivery'].includes(ds)
        ? ds
        : 'new';
    })(),
    deliveryDistanceKm: raw.deliveryDistanceKm,
    deliveryFeeEuro: raw.deliveryFeeEuro ?? 0,
    deliveryPaidByDriver: raw.deliveryPaidByDriver ?? false,
    customerOnlinePaymentAt: raw.customerOnlinePaymentAt,
    stripePaymentIntentId: raw.stripePaymentIntentId,
    pickupSlotLabel: raw.pickupSlotLabel ?? '',
    pickupSlotStart: raw.pickupSlotStart,
    status,
    // 不做会员映射：避免指向错误会员；账务仍以订单行与结账为准
    memberId: undefined,
    customerProfileId: undefined,
    memberPhoneSnapshot: raw.memberPhoneSnapshot ?? '',
    memberCreditUsed: typeof raw.memberCreditUsed === 'number' ? raw.memberCreditUsed : 0,
    items,
    appliedBundles: Array.isArray(raw.appliedBundles) ? raw.appliedBundles : [],
    completedAt: raw.completedAt,
    createdAt: raw.createdAt ?? new Date(),
    updatedAt: raw.updatedAt ?? new Date(),
  };

  return { newDoc, oldId };
}

function mapOrderLine(line: Record<string, unknown>): Record<string, unknown> {
  const opts = Array.isArray(line.selectedOptions)
    ? line.selectedOptions.map((o: unknown) => {
        const x = o as Record<string, unknown>;
        return {
          groupName: x.groupName,
          groupNameEn: x.groupNameEn ?? '',
          choiceName: x.choiceName,
          choiceNameEn: x.choiceNameEn ?? '',
          extraPrice: typeof x.extraPrice === 'number' ? x.extraPrice : 0,
        };
      })
    : [];

  return {
    menuItemId: line.menuItemId,
    lineKind: line.lineKind ?? 'menu',
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    itemName: line.itemName,
    itemNameEn: line.itemNameEn ?? '',
    selectedOptions: opts,
    refunded: !!line.refunded,
  };
}

function mapLegacyCheckout(
  raw: Record<string, unknown>,
  storeId: mongoose.Types.ObjectId,
  orderIdMap: Map<string, mongoose.Types.ObjectId>,
): Record<string, unknown> | null {
  const oldOrderIds = Array.isArray(raw.orderIds) ? raw.orderIds : [];
  const newOrderIds: mongoose.Types.ObjectId[] = [];
  for (const oid of oldOrderIds) {
    const k = String(oid);
    const mapped = orderIdMap.get(k);
    if (mapped) newOrderIds.push(mapped);
  }
  if (newOrderIds.length === 0) {
    return null;
  }

  const pmRaw = String(raw.paymentMethod ?? 'cash');
  const paymentMethod = ['cash', 'card', 'mixed', 'online', 'member'].includes(pmRaw) ? pmRaw : 'cash';

  return {
    _id: new mongoose.Types.ObjectId(),
    storeId,
    type: raw.type === 'seat' ? 'seat' : 'table',
    tableNumber: raw.tableNumber,
    totalAmount: raw.totalAmount,
    paymentMethod,
    cashAmount: raw.cashAmount,
    cardAmount: raw.cardAmount,
    couponName: raw.couponName,
    couponAmount: raw.couponAmount,
    memberId: undefined,
    memberCreditUsed: typeof raw.memberCreditUsed === 'number' ? raw.memberCreditUsed : 0,
    memberCreditRefundedEuro: typeof raw.memberCreditRefundedEuro === 'number' ? raw.memberCreditRefundedEuro : 0,
    memberPhoneSnapshot: raw.memberPhoneSnapshot ?? '',
    orderIds: newOrderIds,
    checkedOutAt: raw.checkedOutAt ?? new Date(),
  };
}

function printStructureNotes(): void {
  console.log(`
=== 结构比对摘要（单店备份 vs 当前多店）===

订单 orders:
  - 多店必填: storeId（导入时写入 tasteofhongkong 对应 Store._id）
  - 单店 type 多为 dine_in|takeout|phone；现系统增加 delivery，旧数据按原样映射
  - 行项目：单店 menuItemId 原必填；现可选；增加 lineKind（默认 menu）
  - 选项：现增加 groupNameEn / choiceNameEn（旧数据补空串）
  - 会员/顾客档案：导入时不保留 memberId / customerProfileId，避免跨库错绑；金额仍以 items + checkouts 为准

结账 checkouts:
  - 多店必填: storeId
  - paymentMethod 现支持 member；旧库仅有 cash|card|mixed|online
  - 增加会员相关字段；旧数据用默认值
  - orderIds 将替换为新库中插入订单后的新 ObjectId（与旧 id 一一对应）

未导入: daily_order_counters（日序与历史订单号无强关联需求时可手工忽略；若需可另脚本按日期重建）

`);
}

async function openSource(): Promise<mongoose.Connection> {
  const uri = process.env.SOURCE_MONGODB_URI?.trim();
  if (!uri) {
    throw new Error('请设置环境变量 SOURCE_MONGODB_URI');
  }
  const dbName = process.env.SOURCE_DB_NAME?.trim();
  const conn = mongoose.createConnection(uri, {
    dbName: dbName || undefined,
    serverSelectionTimeoutMS: 45_000,
  });
  await conn.asPromise();
  return conn;
}

async function main(): Promise<void> {
  const { dryRun, doImport } = parseArgs();
  printStructureNotes();

  const src = await openSource();
  const srcDb = src.db;
  if (!srcDb) throw new Error('源库 db 无效');

  const dbLabel = srcDb.databaseName;
  const ordersCol = srcDb.collection('orders');
  const checkoutsCol = srcDb.collection('checkouts');

  const orderCount = await ordersCol.countDocuments();
  const checkoutCount = await checkoutsCol.countDocuments();

  console.log(`源库: ${dbLabel}`);
  console.log(`orders: ${orderCount} 条, checkouts: ${checkoutCount} 条\n`);

  const sampleOrder = await ordersCol.findOne({});
  const sampleCheckout = await checkoutsCol.findOne({});
  if (sampleOrder) {
    console.log('--- 样本订单顶层字段 ---');
    console.log(Object.keys(sampleOrder).sort().join(', '));
  }
  if (sampleCheckout) {
    console.log('--- 样本结账顶层字段 ---');
    console.log(Object.keys(sampleCheckout).sort().join(', '));
  }
  console.log('');

  if (dryRun) {
    await src.close();
    console.log('dry-run 结束，未写入目标库。确认无误后使用 --import');
    return;
  }

  await connectDB();
  const { Store, Order, Checkout } = getModels();
  const store = await Store.findOne({ slug: TARGET_SLUG }).lean();
  if (!store || !store._id) {
    throw new Error(`目标店铺不存在或无效: slug=${TARGET_SLUG}`);
  }
  const storeId = store._id as mongoose.Types.ObjectId;

  const legacyOrders = await ordersCol.find({}).sort({ createdAt: 1 }).toArray();
  const orderIdMap = new Map<string, mongoose.Types.ObjectId>();
  const newOrders: Record<string, unknown>[] = [];

  for (const row of legacyOrders) {
    const { newDoc, oldId } = mapLegacyOrder(row as Record<string, unknown>, storeId);
    orderIdMap.set(oldId, newDoc._id as mongoose.Types.ObjectId);
    newOrders.push(omitUndefined(newDoc));
  }

  const legacyCheckouts = await checkoutsCol.find({}).sort({ checkedOutAt: 1 }).toArray();
  const newCheckouts: Record<string, unknown>[] = [];
  let skippedCheckouts = 0;

  for (const row of legacyCheckouts) {
    const mapped = mapLegacyCheckout(row as Record<string, unknown>, storeId, orderIdMap);
    if (mapped) newCheckouts.push(omitUndefined(mapped));
    else skippedCheckouts++;
  }

  if (newOrders.length > 0) {
    await Order.collection.insertMany(newOrders, { ordered: false });
  }
  if (newCheckouts.length > 0) {
    await Checkout.collection.insertMany(newCheckouts, { ordered: false });
  }

  console.log(`已写入店铺 ${TARGET_SLUG} (${storeId}):`);
  console.log(`  orders 插入 ${newOrders.length} 条`);
  console.log(`  checkouts 插入 ${newCheckouts.length} 条`);
  if (skippedCheckouts > 0) {
    console.log(`  跳过 checkouts ${skippedCheckouts} 条（orderIds 无法在映射中找到）`);
  }

  await src.close();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
