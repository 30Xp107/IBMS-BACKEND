import { Request, Response, NextFunction } from "express";
import { Redemption } from "../models/redemption.model";
import { Beneficiary } from "../models/beneficiary.model";
import ErrorHandler from "../utils/ErrorHandler";
import { catchAsync } from "../utils/catchAsync";
import { logAudit } from "../utils/auditLogger";
import { getAreaFilter } from "../utils/areaFilter";

export const getRedemptions = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { beneficiary_id, beneficiary_ids, hhid, frm_period, page = 1, limit = 10, search } = req.query;

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
          return res.status(200).json({ redemptions: [], total: 0, page: 1, totalPages: 0 });
        }
      } else {
        query.hhid = { $in: allowedHhids };
      }
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [redemptions, total] = await Promise.all([
      Redemption.find(query)
        .populate("recorded_by", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Redemption.countDocuments(query)
    ]);

    res.status(200).json({
      redemptions,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    });
  }
);

export const createRedemption = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const redemption = await Redemption.create({
      ...req.body,
      recorded_by: user._id,
    });
    await logAudit(req, "CREATE", "redemptions", redemption.id, "", JSON.stringify(redemption));
    res.status(201).json(redemption);
  }
);

export const updateRedemption = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const redemption = await Redemption.findById(req.params.id);
    if (!redemption) {
      return next(new ErrorHandler("Redemption not found", 404));
    }

    Object.assign(redemption, req.body);
    await redemption.save();

    await logAudit(req, "UPDATE", "redemptions", redemption.id, "", JSON.stringify(req.body));

    res.status(200).json(redemption);
  }
);

export const upsertRedemption = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { beneficiary_id, hhid, frm_period, attendance, reason, date_recorded } = req.body;

    const result = await Redemption.findOneAndUpdate(
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

    const redemption = result.value;
    const action = result.lastErrorObject?.updatedExisting ? "UPDATE" : "CREATE";

    if (redemption) {
      await logAudit(req, action, "redemptions", redemption.id, "", JSON.stringify(redemption));
      res.status(200).json(redemption);
    } else {
      return next(new ErrorHandler("Failed to record redemption", 500));
    }
  }
);

export const deleteRedemption = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const redemption = await Redemption.findByIdAndDelete(req.params.id);
    if (!redemption) {
      return next(new ErrorHandler("Redemption not found", 404));
    }

    await logAudit(req, "DELETE", "redemptions", redemption.id, JSON.stringify(redemption), "");

    res.status(200).json({ message: "Redemption deleted", redemption });
  }
);
