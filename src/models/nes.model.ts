import mongoose, { Schema, Document, Types } from "mongoose";

export interface INES extends Document {
  beneficiary_id: string;
  hhid: string;
  frm_period: string;
  attendance: "present" | "absent" | "none" | "redeemed" | "unredeemed";
  reason?: string;
  action?: string;
  date_recorded: string;
  recorded_by: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const nesSchema = new Schema<INES>(
  {
    beneficiary_id: { type: String, required: true },
    hhid: { type: String, required: true },
    frm_period: { type: String, required: true },
    attendance: { type: String, required: true, enum: ["present", "absent", "none", "redeemed", "unredeemed"] },
    reason: { type: String, default: "" },
    action: { type: String, default: "" },
    date_recorded: { type: String, required: true },
    recorded_by: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const NES = mongoose.model<INES>("NES", nesSchema);

