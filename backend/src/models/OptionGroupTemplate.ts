import mongoose from 'mongoose';
import { MenuItemSchema } from './MenuItem';

const OptionGroupSchema = MenuItemSchema.path('optionGroups') as unknown as mongoose.Schema;

const OptionGroupTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  enabled: { type: Boolean, default: true },
  optionGroups: { type: [OptionGroupSchema], default: [] },
}, { timestamps: true });

export const OptionGroupTemplate = mongoose.model(
  'OptionGroupTemplate',
  OptionGroupTemplateSchema,
  'option_group_templates',
);
