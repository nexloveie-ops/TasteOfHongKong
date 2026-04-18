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

const OrderSchema = new mongoose.Schema({
  type: { type: String, enum: ['dine_in', 'takeout'], required: true },
  tableNumber: { type: Number },
  seatNumber: { type: Number },
  dailyOrderNumber: { type: Number },
  dineInOrderNumber: { type: String },
  status: { type: String, enum: ['pending', 'checked_out', 'completed', 'refunded'], default: 'pending' },
  items: [OrderItemSubdocSchema],
  completedAt: { type: Date },
}, { timestamps: true });

export const Order = mongoose.model('Order', OrderSchema, 'orders');
export { OrderSchema, OrderItemSubdocSchema };
