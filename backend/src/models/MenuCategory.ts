import mongoose from 'mongoose';

const CategoryTranslationSchema = new mongoose.Schema({
  locale: { type: String, required: true },
  name: { type: String, required: true },
}, { _id: false });

const MenuCategorySchema = new mongoose.Schema({
  sortOrder: { type: Number, required: true },
  translations: [CategoryTranslationSchema],
}, { timestamps: true });

export { MenuCategorySchema, CategoryTranslationSchema };
