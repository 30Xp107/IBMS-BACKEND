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
    const { barangay, municipality, province, search } = req.query;

    const query: any = {};

    // Filter by user's assigned areas if not admin
    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        query.$and = [areaFilter];
      }
    }

    if (barangay) query.barangay = barangay;
    if (municipality) query.municipality = municipality;
    if (province) query.province = province;

    if (search) {
      const searchRegex = { $regex: search as string, $options: "i" };
      query.$or = [
        { hhid: searchRegex },
        { first_name: searchRegex },
        { last_name: searchRegex },
        { pkno: searchRegex },
      ];
    }

    const beneficiaries = await Beneficiary.find(query).sort({ createdAt: -1 });
    res.status(200).json(beneficiaries);
  }
);

export const createBeneficiary = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const existing = await Beneficiary.findOne({ hhid: req.body.hhid });
    if (existing) {
      return next(new ErrorHandler("HHID already exists", 400));
    }

    const beneficiary = await Beneficiary.create(req.body);
    await logAudit(req, "CREATE", "beneficiaries", beneficiary.id, "", JSON.stringify(beneficiary));
    res.status(201).json(beneficiary);
  }
);

export const updateBeneficiary = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const beneficiary = await Beneficiary.findById(req.params.id);
    if (!beneficiary) {
      return next(new ErrorHandler("Beneficiary not found", 404));
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

