import mongoose from 'mongoose';

const DailyOrderCounterSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },  // Format: 'YYYY-MM-DD'
  currentNumber: { type: Number, default: 0 },
});

export { DailyOrderCounterSchema };
