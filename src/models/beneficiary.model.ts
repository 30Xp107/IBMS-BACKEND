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
    hhid: { type: String, required: true },
    pkno: { type: String, default: "" },
    first_name: { type: String, required: true },
    last_name: { type: String, required: true },
    middle_name: { type: String, default: "" },
    birthdate: { type: String, default: "" },
    gender: { type: String, default: "" },
    address: { type: String, default: "" },
    barangay: { type: String, default: "" },
    municipality: { type: String, default: "" },
    province: { type: String, default: "" },
    region: { type: String, default: "" },
    contact: { type: String, default: "" },
  },
  { timestamps: true }
);

// Add indexes for performance
beneficiarySchema.index({ 
  first_name: 1, 
  last_name: 1, 
  middle_name: 1, 
  birthdate: 1, 
  barangay: 1, 
  municipality: 1, 
  province: 1 
}, { unique: true });
beneficiarySchema.index({ first_name: 1, last_name: 1 });
beneficiarySchema.index({ pkno: 1 });
beneficiarySchema.index({ region: 1 });
beneficiarySchema.index({ province: 1 });
beneficiarySchema.index({ municipality: 1 });
beneficiarySchema.index({ barangay: 1 });

export const Beneficiary = mongoose.model<IBeneficiary>("Beneficiary", beneficiarySchema);

