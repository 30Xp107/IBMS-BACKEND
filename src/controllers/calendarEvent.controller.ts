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

    const query: any = { userId: user._id };

    // Filter by date range if provided
    if (start && end) {
      query.start = {
        $gte: new Date(start as string),
        $lte: new Date(end as string),
      };
    }

    const events = await CalendarEvent.find(query).sort({ start: 1 });

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

    const event = await CalendarEvent.create({
      ...req.body,
      userId: user._id,
    });

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

    let event = await CalendarEvent.findOne({ _id: id, userId: user._id });

    if (!event) {
      return next(new ErrorHandler("Event not found or unauthorized", 404));
    }

    const oldData = JSON.stringify(event);

    event = await CalendarEvent.findByIdAndUpdate(
      id,
      { ...req.body },
      { new: true, runValidators: true }
    );

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

    const event = await CalendarEvent.findOne({ _id: id, userId: user._id });

    if (!event) {
      return next(new ErrorHandler("Event not found or unauthorized", 404));
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
