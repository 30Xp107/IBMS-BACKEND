import mongoose, { Schema, Document } from 'mongoose';

export interface ITravelOrder extends Document {
  requester: mongoose.Types.ObjectId;
  participants: mongoose.Types.ObjectId[];
  date_from: Date;
  date_to: Date;
  destination: {
    region: string;
    province: string;
    municipality: string;
  };
  purpose: string;
  status: 'pending' | 'approved' | 'rejected';
  approver?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const travelOrderSchema = new Schema<ITravelOrder>({
  requester: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  participants: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  date_from: {
    type: Date,
    required: true
  },
  date_to: {
    type: Date,
    required: true
  },
  destination: {
    region: { type: String, required: true },
    province: { type: String, required: true },
    municipality: { type: String, required: true }
  },
  purpose: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  approver: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

export const TravelOrder = mongoose.model<ITravelOrder>('TravelOrder', travelOrderSchema);
