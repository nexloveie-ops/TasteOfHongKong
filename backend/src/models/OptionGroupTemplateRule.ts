import mongoose from 'mongoose';

const OptionGroupTemplateRuleSchema = new mongoose.Schema({
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'OptionGroupTemplate', required: true, index: true },
  enabled: { type: Boolean, default: true },
  priority: { type: Number, default: 100 },
  categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MenuCategory' }],
  menuItemIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' }],
  excludedMenuItemIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' }],
}, { timestamps: true });

export const OptionGroupTemplateRule = mongoose.model(
  'OptionGroupTemplateRule',
  OptionGroupTemplateRuleSchema,
  'option_group_template_rules',
);
