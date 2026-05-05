import mongoose from 'mongoose';

/** 平台代操作审计；集合名 `admin_audit_logs` */
export const AdminAuditLogSchema = new mongoose.Schema(
  {
    actorAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    actorRole: { type: String, required: true },
    targetStoreId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
    action: { type: String, required: true },
    resourceType: { type: String },
    resourceId: { type: mongoose.Schema.Types.ObjectId },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AdminAuditLogSchema.index({ targetStoreId: 1, createdAt: -1 });
AdminAuditLogSchema.index({ actorAdminId: 1, createdAt: -1 });
