import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICalendarEvent extends Document {
  title: string;
  description?: string;
  start: Date;
  end?: Date;
  allDay: boolean;
  type: 'task' | 'event' | 'meeting' | 'deadline';
  userId: Types.ObjectId;
  color?: string;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

const calendarEventSchema = new Schema<ICalendarEvent>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    start: {
      type: Date,
      required: true,
    },
    end: {
      type: Date,
    },
    allDay: {
      type: Boolean,
      default: false,
    },
    type: {
      type: String,
      enum: ['task', 'event', 'meeting', 'deadline'],
      default: 'event',
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    color: {
      type: String,
      default: '#10b981', // emerald-500
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'cancelled'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

// Index for faster queries
calendarEventSchema.index({ userId: 1, start: 1 });

export const CalendarEvent = mongoose.model<ICalendarEvent>('CalendarEvent', calendarEventSchema);
