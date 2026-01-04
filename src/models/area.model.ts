import mongoose, { Schema, Document } from "mongoose";

export interface IArea extends Document {
  name: string;
  code: string; // PSGC Code
  type: "region" | "province" | "municipality" | "barangay";
  parent_id?: string;
  parent_code?: string;
  createdAt: Date;
  updatedAt: Date;
}

const areaSchema = new Schema<IArea>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    type: { type: String, required: true, enum: ["region", "province", "municipality", "barangay"] },
    parent_id: { type: Schema.Types.ObjectId, ref: "Area" },
    parent_code: { type: String },
  },
  { timestamps: true }
);

// Add indexes for performance
areaSchema.index({ type: 1 });
areaSchema.index({ parent_id: 1 });
areaSchema.index({ parent_code: 1 });
areaSchema.index({ name: 1 });
areaSchema.index({ type: 1, parent_id: 1 });

export const Area = mongoose.model<IArea>("Area", areaSchema);
