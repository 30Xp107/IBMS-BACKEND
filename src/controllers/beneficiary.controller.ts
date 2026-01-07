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

    if (barangay && barangay !== "all") {
      query.barangay = { $regex: new RegExp(`^${(barangay as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") };
    }
    if (municipality && municipality !== "all") {
      query.municipality = { $regex: new RegExp(`^${(municipality as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") };
    }
    if (province && province !== "all") {
      query.province = { $regex: new RegExp(`^${(province as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") };
    }
    if (region && region !== "all") {
      query.region = { $regex: new RegExp(`^${(region as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") };
    }

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
    // Check for duplicates (combination of 7 fields)
    const duplicateQuery = {
      first_name: { $regex: new RegExp(`^${(req.body.first_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
      last_name: { $regex: new RegExp(`^${(req.body.last_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
      middle_name: { $regex: new RegExp(`^${(req.body.middle_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
      birthdate: req.body.birthdate || "",
      barangay: { $regex: new RegExp(`^${(req.body.barangay || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
      municipality: { $regex: new RegExp(`^${(req.body.municipality || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
      province: { $regex: new RegExp(`^${(req.body.province || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
    };

    const existing = await Beneficiary.findOne(duplicateQuery);
    if (existing) {
      return next(new ErrorHandler("A beneficiary with the same name, birthdate, and address already exists", 400));
    }

    // Auto-populate region if province is provided but region is missing
    if (req.body.province && !req.body.region) {
      if (req.body.province.toUpperCase() === "CITY OF BACOLOD") {
        req.body.region = "NEGROS ISLAND REGION (NIR)";
      } else {
        const provinceArea = await Area.findOne({ 
          name: { $regex: new RegExp(`^${(req.body.province as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }, 
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

export const bulkCreateBeneficiaries = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { beneficiaries } = req.body;
    if (!beneficiaries || !Array.isArray(beneficiaries)) {
      return next(new ErrorHandler("Invalid beneficiaries data", 400));
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    // Split into chunks for better performance and to avoid memory issues
    // Reduced chunk size to 500 to avoid connection timeouts during large imports
    const chunkSize = 500;
    
    // Pre-fetch all provinces and regions to avoid thousands of DB queries
    const allProvinces = await Area.find({ type: "province" }).populate("parent_id");
    const provinceToRegionMap = new Map<string, string>();
    
    allProvinces.forEach((p: any) => {
      const provinceName = p.name.toUpperCase();
      let regionName = "";
      if (p.parent_id && p.parent_id.name) {
        regionName = p.parent_id.name;
      } else if (p.parent_code) {
        // Fallback if populate didn't work as expected
        regionName = ""; // Will handle in a second pass if needed, but usually populate works
      }
      if (regionName) {
        provinceToRegionMap.set(provinceName, regionName);
      }
    });

    // Proactively drop old HHID unique index if it exists (ignoring errors if it doesn't)
    // This ensures we don't have stray restrictions from previous versions
    await Beneficiary.collection.dropIndex("hhid_1").catch(() => {});

    for (let i = 0; i < beneficiaries.length; i += chunkSize) {
      const chunk = beneficiaries.slice(i, i + chunkSize);
      
      // 1. Auto-populate missing regions & Validate each document
      const validDocs: any[] = [];
      
      for (let j = 0; j < chunk.length; j++) {
        const b = chunk[j];
        
        // Auto-populate missing regions using the map
        if (b.province && !b.region) {
          const provinceKey = b.province.toUpperCase();
          if (provinceToRegionMap.has(provinceKey)) {
            b.region = provinceToRegionMap.get(provinceKey);
          }
        }

        // Validate sync
        const doc = new Beneficiary(b);
        const validationError = doc.validateSync();
        
        if (validationError) {
          results.failed++;
          if (results.errors.length < 50) {
            const errorMsgs = Object.values(validationError.errors).map(e => e.message).join(", ");
            results.errors.push(`Row ${i + j + 1}: ${errorMsgs}`);
          }
        } else {
          validDocs.push(b);
        }
      }
      
      if (validDocs.length === 0) continue;

      try {
        // Use Beneficiary.collection.insertMany for raw performance and predictable ordered:false behavior
        // This bypasses Mongoose validation (we already did it) and hooks.
        const result = await Beneficiary.collection.insertMany(validDocs, { ordered: false }) as any;
        results.success += (result.insertedCount || 0);
      } catch (error: any) {
        // In MongoDB driver, even if it throws, some might have succeeded
        if (error.result) {
          const insertedCount = error.result.nInserted || 0;
          results.success += insertedCount;
          results.failed += (validDocs.length - insertedCount);
        }

        if (error.writeErrors) {
          error.writeErrors.forEach((err: any) => {
            if (results.errors.length < 50) {
              let msg = err.errmsg || 'Unknown database error';
              if (msg.includes('E11000') || msg.includes('duplicate key')) {
                const op = err.op || {};
                const name = `${op.first_name || ''} ${op.last_name || ''}`.trim();
                msg = `Duplicate beneficiary already exists: ${name} (HHID: ${op.hhid || 'unknown'})`;
              }
              results.errors.push(`Row ${i + (err.index || 0) + 1}: ${msg}`);
            }
          });
        } else if (!error.result) {
          // General error for the whole chunk if not a bulk write error
          results.failed += validDocs.length;
          if (results.errors.length < 50) {
            results.errors.push(`Chunk starting at row ${i + 1}: ${error.message || 'Unknown error'}`);
          }
        }
      }
    }

    await logAudit(req, "BULK_CREATE", "beneficiaries", "multiple", "", `Imported ${results.success} beneficiaries, ${results.failed} failed`);

    res.status(201).json(results);
  }
);

export const checkDuplicates = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { beneficiaries } = req.body;
    if (!beneficiaries || !Array.isArray(beneficiaries)) {
      return next(new ErrorHandler("Invalid request body", 400));
    }

    const duplicates: any[] = [];
    const chunkSize = 50; // Much smaller chunk size for complex $or query with regex to avoid timeouts
    
    for (let i = 0; i < beneficiaries.length; i += chunkSize) {
      const chunk = beneficiaries.slice(i, i + chunkSize);
      
      const query = {
        $or: chunk.map(b => ({
          first_name: { $regex: new RegExp(`^${(b.first_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
          last_name: { $regex: new RegExp(`^${(b.last_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
          middle_name: { $regex: new RegExp(`^${(b.middle_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
          birthdate: b.birthdate || "",
          barangay: { $regex: new RegExp(`^${(b.barangay || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
          municipality: { $regex: new RegExp(`^${(b.municipality || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
          province: { $regex: new RegExp(`^${(b.province || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
        }))
      };

      const existing = await Beneficiary.find(query, "hhid first_name last_name middle_name birthdate barangay municipality province");
      duplicates.push(...existing);
    }

    res.status(200).json({
      duplicates
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
          name: { $regex: new RegExp(`^${(req.body.province as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }, 
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

    await logAudit(req, "DELETE", "beneficiaries", req.params.id, "", "Deleted single beneficiary");

    res.status(204).json({ success: true });
  }
);

export const bulkDeleteBeneficiaries = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { ids, all, filters } = req.body;

    let deleteQuery: any = {};

    if (all) {
      // If deleting all based on filters
      if (filters) {
        if (filters.search) {
          deleteQuery.$or = [
            { hhid: { $regex: filters.search, $options: "i" } },
            { pkno: { $regex: filters.search, $options: "i" } },
            { first_name: { $regex: filters.search, $options: "i" } },
            { last_name: { $regex: filters.search, $options: "i" } },
          ];
        }
        if (filters.region && filters.region !== "all") deleteQuery.region = filters.region;
        if (filters.province && filters.province !== "all") deleteQuery.province = filters.province;
        if (filters.municipality && filters.municipality !== "all") deleteQuery.municipality = filters.municipality;
        if (filters.barangay && filters.barangay !== "all") deleteQuery.barangay = filters.barangay;
      }
    } else {
      // If deleting specific IDs
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return next(new ErrorHandler("No IDs provided for deletion", 400));
      }
      deleteQuery = { _id: { $in: ids } };
    }

    const result = await Beneficiary.deleteMany(deleteQuery);

    await logAudit(req, "BULK_DELETE", "beneficiaries", "multiple", "", `Deleted ${result.deletedCount} beneficiaries`);

    res.status(200).json({
      success: true,
      count: result.deletedCount,
    });
  }
);

