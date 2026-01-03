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
    const { beneficiary_id, hhid, frm_period } = req.query;

    const query: any = {};
    if (beneficiary_id) query.beneficiary_id = beneficiary_id;
    if (hhid) query.hhid = hhid;
    if (frm_period) query.frm_period = frm_period;

    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      const beneficiaries = await Beneficiary.find(areaFilter || {}).select("hhid");

      const allowedHhids = beneficiaries.map((b) => b.hhid);

      if (query.hhid) {
        if (!allowedHhids.includes(query.hhid)) {
          return res.status(200).json([]);
        }
      } else {
        query.hhid = { $in: allowedHhids };
      }
    }

    const nesRecords = await NES.find(query)
      .populate("recorded_by", "name email")
      .sort({ createdAt: -1 });
    res.status(200).json(nesRecords);
  }
);

export const createNES = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;
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
    const { beneficiary_id, hhid, frm_period, attendance, reason, date_recorded } = req.body;

    const result = await NES.findOneAndUpdate(
      { beneficiary_id, frm_period },
      {
        beneficiary_id,
        hhid,
        frm_period,
        attendance,
        reason,
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
