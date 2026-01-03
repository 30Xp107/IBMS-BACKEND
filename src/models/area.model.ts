import mongoose, { Schema, Document } from "mongoose";

export interface IArea extends Document {
  name: string;
  type: "province" | "municipality" | "barangay";
  parent_id?: string;
  createdAt: Date;
  updatedAt: Date;
}

const areaSchema = new Schema<IArea>(
  {
    name: { type: String, required: true },
    type: { type: String, required: true, enum: ["province", "municipality", "barangay"] },
    parent_id: { type: Schema.Types.ObjectId, ref: "Area" },
  },
  { timestamps: true }
);

export const Area = mongoose.model<IArea>("Area", areaSchema);
