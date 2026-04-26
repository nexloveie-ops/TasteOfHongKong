import mongoose from 'mongoose';

const OrderItemSubdocSchema = new mongoose.Schema({
  menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true },
  itemName: { type: String, required: true },
  itemNameEn: { type: String, default: '' },
  selectedOptions: [{
    groupName: { type: String },
    choiceName: { type: String },
    extraPrice: { type: Number, default: 0 },
  }],
  refunded: { type: Boolean, default: false },
}, { _id: true });

const AppliedBundleSchema = new mongoose.Schema({
  offerId: { type: String },
  name: { type: String },
  nameEn: { type: String, default: '' },
  discount: { type: Number, required: true },
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  type: { type: String, enum: ['dine_in', 'takeout', 'phone'], required: true },
  tableNumber: { type: Number },
  seatNumber: { type: Number },
  dailyOrderNumber: { type: Number },
  dineInOrderNumber: { type: String },
  status: { type: String, enum: ['pending', 'paid_online', 'checked_out', 'completed', 'refunded', 'checked_out-hide', 'completed-hide'], default: 'pending' },
  items: [OrderItemSubdocSchema],
  appliedBundles: [AppliedBundleSchema],
  completedAt: { type: Date },
}, { timestamps: true });

export const Order = mongoose.model('Order', OrderSchema, 'orders');
export { OrderSchema, OrderItemSubdocSchema };
