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
  await mongoose.connect(dbUri, {
    serverSelectionTimeoutMS: 15_000,
    socketTimeoutMS: 45_000,
  });
  console.log('MongoDB 连接成功');
  const models = registerLZFoodModels(mongoose.connection);
  // Do not block process startup on createIndexes (Cloud Run must bind PORT quickly).
  void ensureLZFoodIndexes(models)
    .then(() => console.log('多店集合与索引已同步'))
    .catch((err) => console.error('多店索引同步失败（服务已启动，可稍后重试或检查日志）:', err));
}
