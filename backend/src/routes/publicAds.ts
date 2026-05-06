import mongoose, { type Model } from 'mongoose';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { getModels } from '../getModels';
import { createAppError } from '../middleware/errorHandler';
import { filterActivePostOrderAds } from '../utils/postOrderAdSchedule';
import { getSlidesFromDoc, type PostOrderSlideInput } from '../utils/postOrderAdSlides';
import { resolveStoreEffectiveFeatures, FeatureKeys } from '../utils/featureCatalog';

async function deactivatePostOrderAdsOverCaps(PostOrderAd: Model<unknown>, ids: mongoose.Types.ObjectId[]): Promise<void> {
  if (ids.length === 0) return;
  await PostOrderAd.updateMany(
    {
      _id: { $in: ids },
      isActive: true,
      maxImpressions: { $type: 'number', $gte: 1 },
      $expr: { $gte: ['$impressionCount', '$maxImpressions'] },
    },
    { $set: { isActive: false } },
  );
  await PostOrderAd.updateMany(
    {
      _id: { $in: ids },
      isActive: true,
      maxClicks: { $type: 'number', $gte: 1 },
      $expr: { $gte: ['$clickCount', '$maxClicks'] },
    },
    { $set: { isActive: false } },
  );
}

const router = Router();

const IMPRESSION_BATCH_MAX = 32;

/**
 * POST /api/public/post-order-ads/impressions
 * body: { adIds: string[] } — 顾客完成页展示上报，每条 id 对应广告 impressionCount +1
 */
router.post('/post-order-ads/impressions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.body?.adIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      res.json({ ok: true, modified: 0 });
      return;
    }
    const unique = [
      ...new Set(
        raw.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((id) => mongoose.Types.ObjectId.isValid(id)),
      ),
    ].slice(0, IMPRESSION_BATCH_MAX);
    if (unique.length === 0) {
      res.json({ ok: true, modified: 0 });
      return;
    }
    const { PostOrderAd } = getModels();
    const oids = unique.map((id) => new mongoose.Types.ObjectId(id));
    const result = await PostOrderAd.updateMany({ _id: { $in: oids } }, { $inc: { impressionCount: 1 } });
    await deactivatePostOrderAdsOverCaps(PostOrderAd, oids);
    res.json({ ok: true, modified: result.modifiedCount });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/public/post-order-ads/click
 * body: { adId: string } — 顾客点击跳转上报 clickCount +1
 */
router.post('/post-order-ads/click', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adId = req.body?.adId;
    if (typeof adId !== 'string' || !mongoose.Types.ObjectId.isValid(adId)) {
      throw createAppError('VALIDATION_ERROR', 'adId 无效');
    }
    const { PostOrderAd } = getModels();
    const oid = new mongoose.Types.ObjectId(adId);
    await PostOrderAd.updateOne({ _id: oid }, { $inc: { clickCount: 1 } });
    await deactivatePostOrderAdsOverCaps(PostOrderAd, [oid]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/post-order-ads
 * 无需店铺头：顾客完成页拉取当前有效横幅（平台统一配置）。
 */
router.get('/post-order-ads', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { PostOrderAd, Store } = getModels() as { PostOrderAd: Model<unknown>; Store: Model<any> };
    const rawSlug = (typeof _req.headers['x-store-slug'] === 'string' ? _req.headers['x-store-slug'] : '').trim().toLowerCase();
    if (rawSlug) {
      const store = await Store.findOne({ slug: rawSlug }).lean() as { _id: mongoose.Types.ObjectId } | null;
      if (store) {
        const features = await resolveStoreEffectiveFeatures(store._id);
        if (!features.has(FeatureKeys.CustomerPostOrderAdsViewAction)) {
          res.json([]);
          return;
        }
      }
    }
    const raw = await PostOrderAd.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    const active = filterActivePostOrderAds(
      raw as unknown as { validFrom: string; validTo: string; windowStart?: string; windowEnd?: string }[],
    );
    type PubRow = {
      _id: string;
      titleZh: unknown;
      titleEn: unknown;
      linkUrl: unknown;
      slides: ReturnType<typeof getSlidesFromDoc>;
    };
    const body: PubRow[] = [];
    for (const doc of active) {
      const o = doc as Record<string, unknown>;
      const slides = getSlidesFromDoc({
        slides: o.slides as PostOrderSlideInput[] | undefined,
        imageUrl: o.imageUrl as string | undefined,
      });
      if (slides.length === 0) continue;
      body.push({
        _id: String(o._id),
        titleZh: o.titleZh,
        titleEn: o.titleEn || '',
        linkUrl: o.linkUrl,
        slides,
      });
    }
    res.json(body);
  } catch (err) {
    next(err);
  }
});

export default router;
