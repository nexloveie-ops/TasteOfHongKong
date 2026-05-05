import mongoose from 'mongoose';

const AllergenTranslationSchema = new mongoose.Schema({
  locale: { type: String, required: true },
  name: { type: String, required: true },
}, { _id: false });

const AllergenSchema = new mongoose.Schema({
  name: { type: String, required: true },
  icon: { type: String, default: '' },
  translations: [AllergenTranslationSchema],
}, { timestamps: true });

export { AllergenSchema, AllergenTranslationSchema };
