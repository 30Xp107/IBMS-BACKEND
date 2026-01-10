import { Request, Response, NextFunction } from "express";
import { NES } from "../models/nes.model";
import { Beneficiary } from "../models/beneficiary.model";
import ErrorHandler from "../utils/ErrorHandler";
import { catchAsync } from "../utils/catchAsync";
import { logAudit } from "../utils/auditLogger";
import { getAreaFilter } from "../utils/areaFilter";

export const getNESRecords = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { beneficiary_id, beneficiary_ids, hhid, frm_period, page = 1, limit = 10, search, sort = "createdAt", order = "desc" } = req.query;

    const query: any = {};
    if (beneficiary_id) query.beneficiary_id = beneficiary_id;
    if (beneficiary_ids) {
      query.beneficiary_id = { $in: (beneficiary_ids as string).split(",") };
    }
    if (hhid) query.hhid = hhid;
    if (frm_period) query.frm_period = frm_period;

    if (search) {
      query.$or = [
        { hhid: { $regex: search as string, $options: "i" } },
        { frm_period: { $regex: search as string, $options: "i" } }
      ];
    }

    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      const beneficiaries = await Beneficiary.find(areaFilter || {}).select("hhid");

      const allowedHhids = beneficiaries.map((b) => b.hhid);

      if (query.hhid) {
        if (typeof query.hhid === 'string' && !allowedHhids.includes(query.hhid)) {
          return res.status(200).json({ nesRecords: [], total: 0, page: 1, totalPages: 0 });
        }
      } else {
        query.hhid = { $in: allowedHhids };
      }
    }

    const pageNum = parseInt(page as string);
    const limitNum = limit === "all" ? 1000000 : parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const sortField = sort as string;
    const sortOrder = order === "asc" ? 1 : -1;
    const sortObj: any = {};
    sortObj[sortField] = sortOrder;

    if (limit === "all") {
      const nesRecords = await NES.find(query)
        .populate("recorded_by", "name email")
        .sort(sortObj);
      return res.status(200).json(nesRecords);
    }

    const [nesRecords, total] = await Promise.all([
      NES.find(query)
        .populate("recorded_by", "name email")
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum),
      NES.countDocuments(query)
    ]);

    res.status(200).json({
      nesRecords,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    });
  }
);

export const createNES = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { beneficiary_id } = req.body;

    const beneficiary = await Beneficiary.findById(beneficiary_id);
    if (!beneficiary) {
      return next(new ErrorHandler("Beneficiary not found", 404));
    }

    if (beneficiary.status === "Not for Recording") {
      return next(new ErrorHandler("This beneficiary is set to 'Not for Recording' status", 400));
    }

    const nes = await NES.create({
      ...req.body,
      recorded_by: user._id,
    });
    await logAudit(req, "CREATE", "nes", nes.id, "", JSON.stringify(nes));
    res.status(201).json(nes);
  }
);

export const updateNES = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const nes = await NES.findById(req.params.id);
    if (!nes) {
      return next(new ErrorHandler("NES record not found", 404));
    }

    Object.assign(nes, req.body);
    await nes.save();

    await logAudit(req, "UPDATE", "nes", nes.id, "", JSON.stringify(req.body));

    res.status(200).json(nes);
  }
);

export const upsertNES = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { beneficiary_id, hhid, frm_period, attendance, reason, action: actionTaken, date_recorded } = req.body;

    const beneficiary = await Beneficiary.findById(beneficiary_id);
    if (!beneficiary) {
      return next(new ErrorHandler("Beneficiary not found", 404));
    }

    if (beneficiary.status === "Not for Recording") {
      return next(new ErrorHandler("This beneficiary is set to 'Not for Recording' status", 400));
    }

    const result = await NES.findOneAndUpdate(
      { beneficiary_id, frm_period },
      {
        beneficiary_id,
        hhid,
        frm_period,
        attendance,
        reason,
        action: actionTaken,
        date_recorded,
        recorded_by: user._id,
      },
      { new: true, upsert: true, runValidators: true, includeResultMetadata: true }
    );

    const nes = result.value;
    const action = result.lastErrorObject?.updatedExisting ? "UPDATE" : "CREATE";
    
    if (nes) {
      await logAudit(req, action, "nes", nes.id, "", JSON.stringify(nes));
      res.status(200).json(nes);
    } else {
      return next(new ErrorHandler("Failed to record NES", 500));
    }
  }
);

export const deleteNES = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const nes = await NES.findByIdAndDelete(req.params.id);
    if (!nes) {
      return next(new ErrorHandler("NES record not found", 404));
    }

    await logAudit(req, "DELETE", "nes", nes.id, JSON.stringify(nes), "");

    res.status(200).json({ message: "NES record deleted", nes });
  }
);
