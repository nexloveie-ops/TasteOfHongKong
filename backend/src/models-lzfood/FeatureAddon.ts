import mongoose from 'mongoose';

export const FeatureAddonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, lowercase: true, unique: true },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    features: [{ type: String, required: true }],
  },
  { timestamps: true },
);

FeatureAddonSchema.index({ code: 1 }, { unique: true });
