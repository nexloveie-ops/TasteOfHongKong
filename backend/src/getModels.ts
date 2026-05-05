import type { LZFoodModels } from './models-lzfood';
import { getLZFoodModels } from './models-lzfood';

/** 多店运行时模型（连接并 `registerLZFoodModels` 后可用） */
export function getModels(): LZFoodModels {
  const m = getLZFoodModels();
  if (!m) {
    throw new Error('数据库模型未初始化：请先 connectDB()');
  }
  return m;
}
