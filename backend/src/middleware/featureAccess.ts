import type { NextFunction, Request, Response } from 'express';
import { createAppError } from './errorHandler';
import { resolveStoreEffectiveFeatures } from '../utils/featureCatalog';

export function requireFeature(featureKey: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.storeId) {
        throw createAppError('FORBIDDEN', '缺少店铺上下文');
      }
      const features = await resolveStoreEffectiveFeatures(req.storeId);
      if (!features.has(featureKey)) {
        throw createAppError('FORBIDDEN', `当前套餐未开通能力：${featureKey}`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
