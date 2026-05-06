import mongoose from 'mongoose';

/** LZFood 租户主档；集合名 `stores` */
export const StoreSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    displayName: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['active', 'suspended', 'expired'],
      default: 'active',
    },
    subscriptionStartsAt: { type: Date, default: () => new Date() },
    subscriptionEndsAt: { type: Date, required: true },
    retentionEndsAt: { type: Date },
    basePlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeaturePlan', default: null },
    enabledAddOnIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FeatureAddon' }],
    featureOverrides: { type: Map, of: Boolean, default: {} },
  },
  { timestamps: true },
);

StoreSchema.index({ status: 1, subscriptionEndsAt: 1 });
