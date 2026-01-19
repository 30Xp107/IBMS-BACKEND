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
    const { beneficiary_id, beneficiary_ids, hhid, frm_period, page = 1, limit = 10, search, sort = "createdAt", order = "desc" } = req.query;

    const query: any = {};
    
    // Determine sort object
    let sortField = sort as string;
    const sortOrder = order === "asc" ? 1 : -1;
    const sortObj: any = {};
    
    // Add secondary sort for stability
    if (sortField === "hhid") {
      sortObj["hhid"] = sortOrder;
      sortObj["createdAt"] = -1;
    } else {
      sortObj[sortField] = sortOrder;
      if (sortField !== "createdAt") {
        sortObj["createdAt"] = -1;
      }
    }
    sortObj["_id"] = -1; // Final fallback for absolute stability
    if (beneficiary_id) {
      if (typeof beneficiary_id === 'string' && beneficiary_id.length === 24) {
        try {
          const objId = new (require('mongoose').Types.ObjectId)(beneficiary_id);
          query.beneficiary_id = { $in: [beneficiary_id, objId] };
        } catch (e) {
          query.beneficiary_id = beneficiary_id;
        }
      } else {
        query.beneficiary_id = beneficiary_id;
      }
    }
    if (beneficiary_ids) {
      const ids = (beneficiary_ids as string).split(",");
      const objIds = ids.map(id => {
        try {
          return id.length === 24 ? new (require('mongoose').Types.ObjectId)(id) : null;
        } catch (e) {
          return null;
        }
      }).filter(id => id !== null);
      
      query.beneficiary_id = { $in: [...ids, ...objIds] };
    }
    if (hhid) query.hhid = hhid;
    if (frm_period) {
      const escapeRegex = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedPeriod = escapeRegex((frm_period as string).trim());
      query.frm_period = { $regex: new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i") };
    }

    if (search) {
      query.$or = [
        { hhid: { $regex: search as string, $options: "i" } },
        { frm_period: { $regex: search as string, $options: "i" } }
      ];
    }

    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      const beneficiaries = await Beneficiary.find(areaFilter || {}).select("_id");

      const allowedBeneficiaryIds = beneficiaries.map((b) => b._id.toString());

      if (query.beneficiary_id) {
        if (typeof query.beneficiary_id === 'string' && !allowedBeneficiaryIds.includes(query.beneficiary_id)) {
          return res.status(200).json({ redemptions: [], total: 0, page: 1, totalPages: 0 });
        }
      } else if (query.beneficiary_ids) {
        // Handle beneficiary_ids already in query (from $in)
        const ids = query.beneficiary_id.$in || [];
        query.beneficiary_id = { $in: ids.filter((id: string) => allowedBeneficiaryIds.includes(id)) };
      } else {
        query.beneficiary_id = { $in: allowedBeneficiaryIds };
      }
    }

    if (limit === "all") {
      const redemptions = await Redemption.find(query)
        .populate("recorded_by", "name email")
        .sort(sortObj);
      return res.status(200).json({ redemptions, total: redemptions.length });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [redemptions, total] = await Promise.all([
      Redemption.find(query)
        .populate("recorded_by", "name email")
        .sort(sortObj)
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

    const oldData = JSON.stringify(redemption);

    Object.assign(redemption, req.body);
    await redemption.save();

    await logAudit(req, "UPDATE", "redemptions", redemption.id, oldData, JSON.stringify(redemption));

    res.status(200).json(redemption);
  }
);

export const upsertRedemption = catchAsync(
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

    // Find existing record to capture old data
    const existingRedemption = await Redemption.findOne({ beneficiary_id, frm_period });
    const oldData = existingRedemption ? JSON.stringify(existingRedemption) : "";

    const result = await Redemption.findOneAndUpdate(
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

    const redemption = result.value;
    const action = result.lastErrorObject?.updatedExisting ? "UPDATE" : "CREATE";

    if (redemption) {
      await logAudit(req, action, "redemptions", redemption.id, oldData, JSON.stringify(redemption));
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
