import { Request, Response, NextFunction } from "express";
import { Area } from "../models/area.model";
import ErrorHandler from "../utils/ErrorHandler";
import { catchAsync } from "../utils/catchAsync";
import { logAudit } from "../utils/auditLogger";

export const getAreas = catchAsync(
  async (req: Request, res: Response) => {
    const { type, parent_id, search } = req.query;

    const query: any = {};
    if (type) query.type = (type as string).toLowerCase();
    if (parent_id === "null") {
      query.parent_id = null;
    } else if (parent_id) {
      query.parent_id = parent_id;
    }
    if (search) {
      query.name = { $regex: search as string, $options: "i" };
    }

    const areas = await Area.find(query)
      .populate("parent_id", "name")
      .sort({ createdAt: -1 });
    res.status(200).json(areas);
  }
);

export const getArea = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const area = await Area.findById(req.params.id);
    if (!area) {
      return next(new ErrorHandler("Area not found", 404));
    }
    res.status(200).json(area);
  }
);

export const createArea = catchAsync(
  async (req: Request, res: Response) => {
    if (req.body.parent_id && typeof req.body.parent_id === 'object' && req.body.parent_id._id) {
      req.body.parent_id = req.body.parent_id._id;
    }
    if (req.body.parent_id === "" || req.body.parent_id === "null" || !req.body.parent_id) {
      req.body.parent_id = null;
    }
    const area = await Area.create(req.body);
    await logAudit(req, "CREATE", "areas", area.id, "", JSON.stringify(area));
    res.status(201).json(area);
  }
);

export const updateArea = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const area = await Area.findById(req.params.id);
    if (!area) {
      return next(new ErrorHandler("Area not found", 404));
    }

    // Handle parent_id if it's an object (from population) or empty
    if (req.body.parent_id && typeof req.body.parent_id === 'object' && req.body.parent_id._id) {
      req.body.parent_id = req.body.parent_id._id;
    }
    if (req.body.parent_id === "" || req.body.parent_id === "null") {
      req.body.parent_id = null;
    }

    Object.assign(area, req.body);
    await area.save();

    await logAudit(req, "UPDATE", "areas", area.id, "", JSON.stringify(req.body));

    res.status(200).json(area);
  }
);

export const deleteArea = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const area = await Area.findByIdAndDelete(req.params.id);
    if (!area) {
      return next(new ErrorHandler("Area not found", 404));
    }

    await logAudit(req, "DELETE", "areas", area.id, JSON.stringify(area), "");

    res.status(200).json({ message: "Area deleted", area });
  }
);
