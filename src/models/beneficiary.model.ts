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
    contact: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Beneficiary = mongoose.model<IBeneficiary>("Beneficiary", beneficiarySchema);

