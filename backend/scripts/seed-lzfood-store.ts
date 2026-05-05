/**
 * 创建首店 + owner 账号（幂等：已存在则跳过）。
 *
 * 环境变量（可选）：
 * SEED_STORE_SLUG, SEED_STORE_DISPLAY_NAME,
 * SEED_OWNER_USERNAME, SEED_OWNER_PASSWORD,
 * SEED_PLATFORM_USERNAME, SEED_PLATFORM_PASSWORD — 平台管理员（默认 lei / 45200159；已存在则更新密码与用户名）
 */
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from '../src/db';
import { getModels } from '../src/getModels';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main(): Promise<void> {
  const slug = (process.env.SEED_STORE_SLUG || 'demo').toLowerCase().trim();
  const displayName = process.env.SEED_STORE_DISPLAY_NAME || slug;
  const ownerUser = process.env.SEED_OWNER_USERNAME || 'owner';
  const ownerPass = process.env.SEED_OWNER_PASSWORD || 'owner123';
  const platUser = (process.env.SEED_PLATFORM_USERNAME || 'lei').trim();
  const platPass = process.env.SEED_PLATFORM_PASSWORD || '45200159';

  await connectDB();
  const { Store, Admin } = getModels();

  let store = await Store.findOne({ slug });
  if (!store) {
    store = await Store.create({
      slug,
      displayName,
      subscriptionEndsAt: new Date('2099-12-31'),
    });
    console.log('Created store', slug, store._id);
  } else {
    console.log('Store exists', slug, store._id);
  }

  const ownerHash = await bcrypt.hash(ownerPass, 10);
  const ownerExisting = await Admin.findOne({ storeId: store._id, username: ownerUser });
  if (!ownerExisting) {
    await Admin.create({
      username: ownerUser,
      passwordHash: ownerHash,
      role: 'owner',
      storeId: store._id,
    });
    console.log('Created owner', ownerUser);
  } else {
    console.log('Owner exists', ownerUser);
  }

  const ph = await bcrypt.hash(platPass, 10);
  let pe = await Admin.findOne({ role: 'platform_owner' });
  if (pe) {
    pe.set('username', platUser);
    pe.set('passwordHash', ph);
    await pe.save();
    console.log('Updated platform_owner →', platUser);
  } else {
    pe = await Admin.create({ username: platUser, passwordHash: ph, role: 'platform_owner' });
    console.log('Created platform_owner', platUser);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
