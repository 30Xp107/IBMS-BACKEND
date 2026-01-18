import { Request, Response, NextFunction } from "express";
import { CalendarEvent } from "../models/calendarEvent.model";
import ErrorHandler from "../utils/ErrorHandler";
import { catchAsync } from "../utils/catchAsync";
import { logAudit } from "../utils/auditLogger";

// Get all events for the current user
export const getCalendarEvents = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { start, end } = req.query;

    let query: any = {};

    // Everyone sees their own events OR events shared by admins
    query = {
      $or: [
        { userId: user._id },
        { isShared: true }
      ]
    };

    // Filter by date range if provided
    if (start && end) {
      const s = new Date(start as string);
      const e = new Date(end as string);

      const dateFilter = {
        $or: [
          {
            start: { $lte: e },
            end: { $gte: s }
          },
          {
            start: { $gte: s, $lte: e },
            $or: [{ end: { $exists: false } }, { end: null }]
          }
        ]
      };

      if (query.$or) {
        query = { $and: [{ $or: query.$or }, dateFilter] };
      } else {
        Object.assign(query, dateFilter);
      }
    }

    const events = await CalendarEvent.find(query)
      .populate("userId", "name email role")
      .sort({ start: 1 });

    res.status(200).json({
      success: true,
      events,
    });
  }
);

// Create a new event
export const createCalendarEvent = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { isShared, ...eventData } = req.body;

    const event = await CalendarEvent.create({
      ...eventData,
      isShared: user.role === 'admin' ? isShared : false,
      userId: user._id,
    });

    await event.populate("userId", "name email role");

    await logAudit(req, "CREATE", "calendar_events", event.id, "", JSON.stringify(event));

    res.status(201).json({
      success: true,
      event,
    });
  }
);

// Update an event
export const updateCalendarEvent = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { id } = req.params;

    let event = await CalendarEvent.findById(id);

    if (!event) {
      return next(new ErrorHandler("Event not found", 404));
    }

    // Only allow if owner
    if (event.userId.toString() !== user._id.toString()) {
      return next(new ErrorHandler("Unauthorized to update this event", 403));
    }

    const oldData = JSON.stringify(event);
    
    const updateData = { ...req.body };
    // Users cannot change isShared status
    if (user.role !== 'admin') {
      delete updateData.isShared;
    }

    event = await CalendarEvent.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate("userId", "name email role");

    await logAudit(req, "UPDATE", "calendar_events", id, oldData, JSON.stringify(event));

    res.status(200).json({
      success: true,
      event,
    });
  }
);

// Delete an event
export const deleteCalendarEvent = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { id } = req.params;

    const event = await CalendarEvent.findById(id);

    if (!event) {
      return next(new ErrorHandler("Event not found", 404));
    }

    // Allow if owner or admin
    if (event.userId.toString() !== user._id.toString() && user.role !== 'admin') {
      return next(new ErrorHandler("Unauthorized to delete this event", 403));
    }

    const oldData = JSON.stringify(event);
    await event.deleteOne();

    await logAudit(req, "DELETE", "calendar_events", id, oldData, "");

    res.status(200).json({
      success: true,
      message: "Event deleted successfully",
    });
  }
);
