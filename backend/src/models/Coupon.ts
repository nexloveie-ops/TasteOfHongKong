import mongoose from 'mongoose';

const CouponSchema = new mongoose.Schema({
  name: { type: String, required: true },
  nameEn: { type: String, default: '' },
  amount: { type: Number, required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true });

export { CouponSchema };
