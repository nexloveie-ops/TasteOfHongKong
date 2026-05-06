import mongoose from 'mongoose';
import { getModels } from '../getModels';

export const FeatureKeys = {
  CashierDeliveryPage: 'cashier.delivery.page',
  AdminOptionTemplatePage: 'admin.optionGroupTemplates.page',
  AdminOffersPage: 'admin.offers.page',
  AdminCouponsPage: 'admin.coupons.page',
  AdminOrderHistoryPage: 'admin.orderHistory.page',
  AdminReportsVatExportAction: 'admin.reports.vatExport.action',
  AdminInventoryRestoreTimeAction: 'admin.inventory.restoreTime.action',
  PlatformPostOrderAdsManageAction: 'platform.postOrderAds.manage.action',
  /** 仅用于店铺 `featureOverrides` 显式设为 `false` 时关闭顾客端下单后广告；勿再用于 Plan「开启」广告 */
  CustomerPostOrderAdsViewAction: 'customer.postOrderAds.view.action',
} as const;

const DEFAULT_BASE_FEATURES = new Set<string>([
  // Base by default keeps core inventory/reports pages available.
  'admin.inventory.page',
  'admin.reports.page',
]);

type StoreDocLite = {
  _id: mongoose.Types.ObjectId;
  basePlanId?: mongoose.Types.ObjectId | null;
  enabledAddOnIds?: mongoose.Types.ObjectId[];
  featureOverrides?: Map<string, boolean> | Record<string, boolean>;
};

export async function resolveStoreEffectiveFeatures(storeId: mongoose.Types.ObjectId): Promise<Set<string>> {
  const { Store, FeaturePlan, FeatureAddon } = getModels() as {
    Store: mongoose.Model<any>;
    FeaturePlan: mongoose.Model<any>;
    FeatureAddon: mongoose.Model<any>;
  };
  const store = (await Store.findById(storeId).lean()) as StoreDocLite | null;
  if (!store) return new Set(DEFAULT_BASE_FEATURES);

  const out = new Set<string>(DEFAULT_BASE_FEATURES);

  if (store.basePlanId) {
    const plan = (await FeaturePlan.findById(store.basePlanId).lean()) as { features?: string[] } | null;
    for (const f of plan?.features || []) out.add(String(f));
  }

  if (Array.isArray(store.enabledAddOnIds) && store.enabledAddOnIds.length > 0) {
    const addons = (await FeatureAddon.find({ _id: { $in: store.enabledAddOnIds } }).lean()) as { features?: string[] }[];
    for (const a of addons) for (const f of a.features || []) out.add(String(f));
  }

  const ov = store.featureOverrides;
  if (ov) {
    const entries = ov instanceof Map ? [...ov.entries()] : Object.entries(ov);
    for (const [k, v] of entries) {
      if (v) out.add(k);
      else out.delete(k);
    }
  }

  return out;
}
