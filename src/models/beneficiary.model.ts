import mongoose, { Schema, Document } from "mongoose";

export interface IBeneficiary extends Document {
  hhid: string;
  pkno: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  birthdate: string;
  gender: string;
  address?: string;
  barangay: string;
  municipality: string;
  province: string;
  region: string;
  contact?: string;
  createdAt: Date;
  updatedAt: Date;
}

const beneficiarySchema = new Schema<IBeneficiary>(
  {
    hhid: { type: String, required: true, unique: true },
    pkno: { type: String, required: true },
    first_name: { type: String, required: true },
    last_name: { type: String, required: true },
    middle_name: { type: String, default: "" },
    birthdate: { type: String, required: true },
    gender: { type: String, required: true },
    address: { type: String, default: "" },
    barangay: { type: String, required: true },
    municipality: { type: String, required: true },
    province: { type: String, required: true },
    region: { type: String, required: true },
    contact: { type: String, default: "" },
  },
  { timestamps: true }
);

// Add indexes for performance
beneficiarySchema.index({ first_name: 1, last_name: 1 });
beneficiarySchema.index({ pkno: 1 });
beneficiarySchema.index({ region: 1 });
beneficiarySchema.index({ province: 1 });
beneficiarySchema.index({ municipality: 1 });
beneficiarySchema.index({ barangay: 1 });

export const Beneficiary = mongoose.model<IBeneficiary>("Beneficiary", beneficiarySchema);

