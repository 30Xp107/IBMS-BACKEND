import { Request, Response, NextFunction } from "express";
import { Beneficiary } from "../models/beneficiary.model";
import { Area } from "../models/area.model";
import ErrorHandler from "../utils/ErrorHandler";
import { catchAsync } from "../utils/catchAsync";
import { logAudit } from "../utils/auditLogger";
import { getAreaFilter } from "../utils/areaFilter";

export const getBeneficiaries = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { barangay, municipality, province, region, search, page = 1, limit = 10 } = req.query;

    const query: any = {};

    // Filter by user's assigned areas if not admin
    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        query.$and = [areaFilter];
      }
    }

    if (barangay && barangay !== "all") query.barangay = barangay;
    if (municipality && municipality !== "all") query.municipality = municipality;
    if (province && province !== "all") query.province = province;
    if (region && region !== "all") query.region = region;

    if (search) {
      const searchRegex = { $regex: search as string, $options: "i" };
      const searchFields = [
        { hhid: searchRegex },
        { first_name: searchRegex },
        { last_name: searchRegex },
        { pkno: searchRegex },
      ];
      if (query.$and) {
        query.$and.push({ $or: searchFields });
      } else {
        query.$or = searchFields;
      }
    }

    if (limit === "all") {
      const beneficiaries = await Beneficiary.find(query).sort({ createdAt: -1 });
      return res.status(200).json({ beneficiaries, total: beneficiaries.length });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [beneficiaries, total] = await Promise.all([
      Beneficiary.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Beneficiary.countDocuments(query)
    ]);

    res.status(200).json({
      beneficiaries,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    });
  }
);

export const createBeneficiary = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const existing = await Beneficiary.findOne({ hhid: req.body.hhid });
    if (existing) {
      return next(new ErrorHandler("HHID already exists", 400));
    }

    // Auto-populate region if missing but province is present
    if (!req.body.region && req.body.province) {
      if (req.body.province.toUpperCase() === "CITY OF BACOLOD") {
        req.body.region = "NEGROS ISLAND REGION (NIR)";
      } else {
        const provinceArea = await Area.findOne({ 
          name: { $regex: new RegExp(`^${req.body.province}$`, "i") }, 
          type: "province" 
        }).populate("parent_id");
        
        if (provinceArea && provinceArea.parent_id && (provinceArea.parent_id as any).name) {
          req.body.region = (provinceArea.parent_id as any).name;
        } else if (provinceArea && provinceArea.parent_code) {
          const regionArea = await Area.findOne({ code: provinceArea.parent_code, type: "region" });
          if (regionArea) req.body.region = regionArea.name;
        }
      }
    }

    const beneficiary = await Beneficiary.create(req.body);
    await logAudit(req, "CREATE", "beneficiaries", beneficiary.id, "", JSON.stringify(beneficiary));
    res.status(201).json(beneficiary);
  }
);

export const checkDuplicates = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { hhids } = req.body;
    if (!hhids || !Array.isArray(hhids)) {
      return next(new ErrorHandler("Invalid request body", 400));
    }

    const existing = await Beneficiary.find({ hhid: { $in: hhids } }, "hhid first_name last_name");
    res.status(200).json({
      duplicates: existing
    });
  }
);

export const updateBeneficiary = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const beneficiary = await Beneficiary.findById(req.params.id);
    if (!beneficiary) {
      return next(new ErrorHandler("Beneficiary not found", 404));
    }

    // Auto-populate region if province is changed but region is not provided or needs update
    if (req.body.province && (req.body.province !== beneficiary.province || !beneficiary.region)) {
      if (req.body.province.toUpperCase() === "CITY OF BACOLOD") {
        req.body.region = "NEGROS ISLAND REGION (NIR)";
      } else {
        const provinceArea = await Area.findOne({ 
          name: { $regex: new RegExp(`^${req.body.province}$`, "i") }, 
          type: "province" 
        }).populate("parent_id");
        
        if (provinceArea && provinceArea.parent_id && (provinceArea.parent_id as any).name) {
          req.body.region = (provinceArea.parent_id as any).name;
        } else if (provinceArea && provinceArea.parent_code) {
          const regionArea = await Area.findOne({ code: provinceArea.parent_code, type: "region" });
          if (regionArea) req.body.region = regionArea.name;
        }
      }
    }

    Object.assign(beneficiary, req.body);
    await beneficiary.save();

    await logAudit(req, "UPDATE", "beneficiaries", beneficiary.id, "", JSON.stringify(req.body));

    res.status(200).json(beneficiary);
  }
);

export const deleteBeneficiary = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const beneficiary = await Beneficiary.findByIdAndDelete(req.params.id);
    if (!beneficiary) {
      return next(new ErrorHandler("Beneficiary not found", 404));
    }

    await logAudit(req, "DELETE", "beneficiaries", beneficiary.id, JSON.stringify(beneficiary), "");

    res.status(200).json({ message: "Beneficiary deleted", beneficiary });
  }
);

