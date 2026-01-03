import mongoose, { Schema, Document, Types } from "mongoose";

export interface IRedemption extends Document {
  beneficiary_id: string;
  hhid: string;
  frm_period: string;
  attendance: "present" | "absent" | "none";
  reason?: string;
  date_recorded: string;
  recorded_by: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const redemptionSchema = new Schema<IRedemption>(
  {
    beneficiary_id: { type: String, required: true },
    hhid: { type: String, required: true },
    frm_period: { type: String, required: true },
    attendance: { type: String, required: true, enum: ["present", "absent", "none"] },
    reason: { type: String, default: "" },
    date_recorded: { type: String, required: true },
    recorded_by: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const Redemption = mongoose.model<IRedemption>("Redemption", redemptionSchema);

