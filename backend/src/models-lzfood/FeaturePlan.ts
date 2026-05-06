import mongoose from 'mongoose';

export const FeaturePlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, lowercase: true, unique: true },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    features: [{ type: String, required: true }],
  },
  { timestamps: true },
);

FeaturePlanSchema.index({ code: 1 }, { unique: true });
