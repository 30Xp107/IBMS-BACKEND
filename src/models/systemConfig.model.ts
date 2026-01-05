import mongoose, { Schema, Document } from "mongoose";

export interface ISystemConfig extends Document {
  key: string;
  value: any;
  description?: string;
  updatedBy: mongoose.Types.ObjectId | string;
}

const systemConfigSchema = new Schema<ISystemConfig>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    description: { type: String },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const SystemConfig = mongoose.model<ISystemConfig>("SystemConfig", systemConfigSchema);
