import mongoose from 'mongoose';

const DailyOrderCounterSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },  // Format: 'YYYY-MM-DD'
  currentNumber: { type: Number, default: 0 },
});

export const DailyOrderCounter = mongoose.model('DailyOrderCounter', DailyOrderCounterSchema, 'daily_order_counters');
export { DailyOrderCounterSchema };
