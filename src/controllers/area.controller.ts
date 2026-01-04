import { Request, Response, NextFunction } from "express";
import { Area } from "../models/area.model";
import ErrorHandler from "../utils/ErrorHandler";
import { catchAsync } from "../utils/catchAsync";
import { logAudit } from "../utils/auditLogger";

export const getAreas = catchAsync(
  async (req: Request, res: Response) => {
    const { type, parent_id, parent_code, search, code, page = 1, limit = 100, sort = "code", order = "asc" } = req.query;

    const query: any = {};
    if (type) query.type = (type as string).toLowerCase();
    if (code) query.code = code;
    if (parent_code) query.parent_code = parent_code;
    
    if (parent_id === "null") {
      query.parent_id = null;
    } else if (parent_id) {
      query.parent_id = parent_id;
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search as string, $options: "i" } },
        { code: { $regex: search as string, $options: "i" } }
      ];
    }

    const sortOrder = order === "desc" ? -1 : 1;
    const sortOptions: any = {};
    sortOptions[sort as string] = sortOrder;
    // Add secondary sort for stability
    if (sort !== "code") sortOptions["code"] = 1;

    // If limit is "all", don't paginate (be careful with this for large datasets)
    if (limit === "all") {
      const areas = await Area.find(query)
        .populate("parent_id", "name code")
        .sort(sortOptions);
      return res.status(200).json(areas);
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [areas, total] = await Promise.all([
      Area.find(query)
        .populate("parent_id", "name code")
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum),
      Area.countDocuments(query)
    ]);

    res.status(200).json({
      areas,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    });
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
