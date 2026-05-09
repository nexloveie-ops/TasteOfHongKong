import mongoose from 'mongoose';

/** 单店会员；主键业务号为 memberNo，手机可变更，不作为唯一主键（MVP 仍建 (storeId, phone) 唯一索引减少歧义） */
const MemberSchema = new mongoose.Schema(
  {
    memberNo: { type: Number, required: true, min: 1 },
    phone: { type: String, required: true, trim: true },
    displayName: { type: String, default: '', trim: true },
    /** 会员自助维护的默认送餐地址（扫码下单等可后续预填；与 CustomerProfile 可并存） */
    deliveryAddress: { type: String, default: '', trim: true },
    postalCode: { type: String, default: '', trim: true },
    pinHash: { type: String, required: true },
    pinFailedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    creditBalance: { type: Number, default: 0, min: 0 },
    walletVersion: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'frozen', 'deleted'], default: 'active' },
    lastPurchaseAt: { type: Date },
  },
  { timestamps: true },
);

MemberSchema.index({ storeId: 1, memberNo: 1 }, { unique: true });
MemberSchema.index({ storeId: 1, phone: 1 }, { unique: true });
MemberSchema.index({ storeId: 1, status: 1 });

export { MemberSchema };
