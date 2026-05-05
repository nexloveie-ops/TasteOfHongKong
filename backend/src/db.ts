import mongoose from 'mongoose';
import { ensureLZFoodIndexes, registerLZFoodModels } from './models-lzfood';

/**
 * 连接 MongoDB 并注册多店模型（唯一连接）。
 * 优先 `LZFOOD_DBCON`，否则 `DBCON`，便于本地与部署统一。
 */
export async function connectDB(): Promise<void> {
  const dbUri = process.env.LZFOOD_DBCON?.trim() || process.env.DBCON;
  if (!dbUri) {
    throw new Error('环境变量 DBCON 或 LZFOOD_DBCON 至少设置其一');
  }
  await mongoose.connect(dbUri);
  console.log('MongoDB 连接成功');
  const models = registerLZFoodModels(mongoose.connection);
  await ensureLZFoodIndexes(models);
  console.log('多店集合与索引已同步');
}
