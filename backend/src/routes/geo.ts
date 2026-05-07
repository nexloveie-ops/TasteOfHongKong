import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { getModels } from '../getModels';
import { createAppError } from '../middleware/errorHandler';
import { requireAuthSameStore } from '../middleware/authForStore';
import { requireFeature } from '../middleware/featureAccess';
import { FeatureKeys } from '../utils/featureCatalog';
import { normalizeIrishEircode } from '../utils/irishEircode';
import { googleGeocodeAddress } from '../utils/googleGeocode';
import { haversineKm } from '../utils/haversineKm';

type StoreGeoCache = { lat: number; lng: number; at: number };
const storeLatLngCache = new Map<string, StoreGeoCache>();
const STORE_GEO_TTL_MS = 60 * 60 * 1000;

async function resolveStoreGeocodeQuery(storeId: mongoose.Types.ObjectId): Promise<string | null> {
  const { SystemConfig, Store } = getModels() as {
    SystemConfig: mongoose.Model<any>;
    Store: mongoose.Model<any>;
  };
  const configs = await SystemConfig.find({ storeId }).lean();
  const map: Record<string, string> = {};
  for (const c of configs) {
    map[c.key] = c.value;
  }
  const storeDoc = (await Store.findById(storeId).lean()) as { displayName?: string } | null;
  const name = (
    map.restaurant_name_en ||
    map.restaurant_name_zh ||
    storeDoc?.displayName ||
    ''
  ).trim();
  const addr = (map.restaurant_address_en || map.restaurant_address || '').trim();
  if (!addr) return null;
  const parts = [name, addr].filter(Boolean);
  return parts.join(', ');
}

async function getStoreLatLng(
  storeId: mongoose.Types.ObjectId,
  apiKey: string,
): Promise<{ lat: number; lng: number }> {
  const key = storeId.toString();
  const now = Date.now();
  const hit = storeLatLngCache.get(key);
  if (hit && now - hit.at < STORE_GEO_TTL_MS) {
    return { lat: hit.lat, lng: hit.lng };
  }

  const query = await resolveStoreGeocodeQuery(storeId);
  if (!query) {
    throw createAppError(
      'VALIDATION_ERROR',
      '请在后台「餐厅信息」中填写店铺地址（restaurant_address），以便计算送餐距离',
    );
  }

  const geo = await googleGeocodeAddress(query, apiKey);
  if (!geo) {
    throw createAppError(
      'VALIDATION_ERROR',
      '无法解析店铺地址坐标，请检查后台填写的地址是否正确',
    );
  }

  storeLatLngCache.set(key, { lat: geo.lat, lng: geo.lng, at: now });
  return { lat: geo.lat, lng: geo.lng };
}

const router = Router();

/** GET /api/geo/eircode?code=D02AF30 — Geocode Irish Eircode, fill-style address + straight-line km from store */
router.get(
  '/eircode',
  ...requireAuthSameStore,
  requireFeature(FeatureKeys.CashierDeliveryPage),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const apiKey = process.env.GoogleGeo?.trim();
      if (!apiKey) {
        throw createAppError('SERVICE_UNAVAILABLE', '未配置 GoogleGeo 环境变量，无法解析邮编');
      }

      const raw = typeof req.query.code === 'string' ? req.query.code.trim() : '';
      const eircode = normalizeIrishEircode(raw);
      if (!eircode) {
        throw createAppError(
          'VALIDATION_ERROR',
          '请输入完整爱尔兰邮编（Eircode，7 位字母与数字，可含空格）',
        );
      }

      const dest = await googleGeocodeAddress(`${eircode}, Ireland`, apiKey);
      if (!dest) {
        throw createAppError('VALIDATION_ERROR', '无法识别该邮编，请核对后重试');
      }

      const storeLoc = await getStoreLatLng(req.storeId!, apiKey);
      const distanceKm = haversineKm(storeLoc.lat, storeLoc.lng, dest.lat, dest.lng);

      res.json({
        eircode,
        formattedAddress: dest.formattedAddress,
        distanceKm: Math.round(distanceKm * 100) / 100,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
