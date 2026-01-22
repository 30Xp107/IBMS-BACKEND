import mongoose, { Schema, Document } from "mongoose";

export interface IPwdType {
  type: string;
  count: number;
}

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
  is4ps?: string;
  status: string;
  num_hh_0_18?: number;
  num_hh_pregnant?: number;
  num_hh_lactating?: number;
  num_hh_pwd?: number;
  pwd_types?: IPwdType[];
  num_hh_60_above?: number;
  num_hh_solo_parent?: number;
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
    is4ps: { type: String, default: "No" },
    status: { 
      type: String, 
      enum: ["Active", "Inactive", "Not for Recording"], 
      default: "Active" 
    },
    num_hh_0_18: { type: Number, default: 0 },
    num_hh_pregnant: { type: Number, default: 0 },
    num_hh_lactating: { type: Number, default: 0 },
    num_hh_pwd: { type: Number, default: 0 },
    pwd_types: { 
      type: [{
        type: { type: String },
        count: { type: Number, default: 1 }
      }], 
      default: [] 
    },
    num_hh_60_above: { type: Number, default: 0 },
    num_hh_solo_parent: { type: Number, default: 0 },
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
beneficiarySchema.index({ hhid: 1 });
beneficiarySchema.index({ pkno: 1 });
beneficiarySchema.index({ region: 1 });
beneficiarySchema.index({ province: 1 });
beneficiarySchema.index({ municipality: 1 });
beneficiarySchema.index({ barangay: 1 });

export const Beneficiary = mongoose.model<IBeneficiary>("Beneficiary", beneficiarySchema);

