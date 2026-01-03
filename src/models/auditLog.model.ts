import mongoose, { Schema, Document } from "mongoose";

export interface IAuditLog extends Document {
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  module: string;
  record_id: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    user_id: { type: String, required: true },
    user_name: { type: String, required: true },
    user_role: { type: String, required: true },
    action: { type: String, required: true },
    module: { type: String, required: true },
    record_id: { type: String, required: true },
    field_name: { type: String },
    old_value: { type: String },
    new_value: { type: String },
  },
  { timestamps: true }
);

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);

