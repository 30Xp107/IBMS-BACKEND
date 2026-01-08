import { Request, Response, NextFunction } from "express";
import { Beneficiary } from "../models/beneficiary.model";
import { Area } from "../models/area.model";
import ErrorHandler from "../utils/ErrorHandler";
import { catchAsync } from "../utils/catchAsync";
import { logAudit } from "../utils/auditLogger";
import { getAreaFilter } from "../utils/areaFilter";

/**
 * Standardizes area names in the request body based on the Area collection
 */
const standardizeAreaNames = async (body: any) => {
  const types = ['region', 'province', 'municipality', 'barangay'];
  
  for (const type of types) {
    const value = body[type];
    if (value && typeof value === 'string' && value.toLowerCase() !== 'all') {
      const val = value.trim();
      const escapedValue = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      let pattern = `^${escapedValue}$`;
      
      if (type === 'municipality') {
        const cityMatch = val.match(/^(city of\s+)?(.+?)(\s+city)?(\s*\(.+?\))?$/i);
        const muniMatch = val.match(/^(municipality of\s+)?(.+?)(\s+municipality)?(\s*\(.+?\))?$/i);
        
        const core = (cityMatch?.[2] || muniMatch?.[2] || val).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = `^((city of\\s+)?${core}(\\s+city)?|(municipality of\\s+)?${core}(\\s+municipality)?)(\\s*\\(.+?\\))?$`;
      }
      
      const areaRecord = await Area.findOne({
        type: type as any,
        name: { $regex: new RegExp(pattern, "i") }
      });
      
      if (areaRecord) {
        body[type] = areaRecord.name;
      }
    }
  }
};

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
      const escapedValue = (barangay as string).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.barangay = { $regex: new RegExp(`^${escapedValue}$`, "i") };
    }
    if (municipality && municipality !== "all") {
      const val = (municipality as string).trim();
      const escapedValue = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cityMatch = val.match(/^(city of\s+)?(.+?)(\s+city)?(\s*\(.+?\))?$/i);
      const muniMatch = val.match(/^(municipality of\s+)?(.+?)(\s+municipality)?(\s*\(.+?\))?$/i);
      
      const core = (cityMatch?.[2] || muniMatch?.[2] || val).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Final robust pattern:
      // 1. Matches core name (escaped)
      // 2. Allows optional "City of" or "City" or "Municipality of" or "Municipality"
      // 3. Allows optional suffix in parentheses at the end (e.g. " (Saravia)")
      // 4. Case-insensitive
      const pattern = `^((city of\\s+)?${core}(\\s+city)?|(municipality of\\s+)?${core}(\\s+municipality)?)(\\s*\\(.+?\\))?$`;
      
      query.municipality = { $regex: new RegExp(pattern, "i") };
    }
    if (province && province !== "all") {
      const escapedValue = (province as string).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.province = { $regex: new RegExp(`^${escapedValue}$`, "i") };
    }
    if (region && region !== "all") {
      const escapedValue = (region as string).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.region = { $regex: new RegExp(`^${escapedValue}$`, "i") };
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
    const user = (req as any).user;

    // Check area authorization for non-admin users
    if (user.role !== "admin") {
      if (!user.assigned_areas || user.assigned_areas.length === 0) {
        return next(new ErrorHandler("You are not assigned to any areas and cannot create beneficiaries", 403));
      }

      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        // Check manually against authorized areas
        const assignedAreas = await Area.find({
          $or: [
            { _id: { $in: user.assigned_areas.map((a: any) => typeof a === 'object' ? a._id : a).filter((id: any) => id && id.toString().match(/^[0-9a-fA-F]{24}$/)) } },
            { name: { $in: user.assigned_areas.map((a: any) => typeof a === 'object' ? a.name : a) } }
          ]
        });

        const isMatch = assignedAreas.some(area => {
          const escapedName = area.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`^${escapedName}$`, "i");
          if (area.type === 'region') return regex.test(req.body.region || "");
          if (area.type === 'province') return regex.test(req.body.province || "");
          if (area.type === 'municipality') return regex.test(req.body.municipality || "");
          if (area.type === 'barangay') return regex.test(req.body.barangay || "");
          return false;
        });

        if (!isMatch) {
          return next(new ErrorHandler("You are not authorized to create beneficiaries in this area", 403));
        }
      }
    }

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

    // Standardize area names before saving
    await standardizeAreaNames(req.body);

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
    const provinceStandardMap = new Map<string, string>();
    
    allProvinces.forEach((p: any) => {
      const canonicalName = p.name;
      const provinceName = p.name.toUpperCase();
      provinceStandardMap.set(provinceName, canonicalName);
      
      let regionName = "";
      if (p.parent_id && p.parent_id.name) {
        regionName = p.parent_id.name;
      }
      if (regionName) {
        provinceToRegionMap.set(provinceName, regionName);
      }
    });

    // Pre-fetch all municipalities for standardization
    const allMunicipalities = await Area.find({ type: "municipality" });
    const muniMap = new Map<string, string>();
    
    allMunicipalities.forEach((m: any) => {
      const canonicalName = m.name;
      const val = m.name.trim();
      muniMap.set(val.toUpperCase(), canonicalName);
      
      const cityMatch = val.match(/^(city of\s+)?(.+?)(\s+city)?(\s*\(.+?\))?$/i);
      const muniMatch = val.match(/^(municipality of\s+)?(.+?)(\s+municipality)?(\s*\(.+?\))?$/i);
      
      if (cityMatch && cityMatch[2]) {
        const core = cityMatch[2].toUpperCase();
        muniMap.set(core, canonicalName);
        muniMap.set(`${core} CITY`, canonicalName);
        muniMap.set(`CITY OF ${core}`, canonicalName);
      } else if (muniMatch && muniMatch[2]) {
        const core = muniMatch[2].toUpperCase();
        muniMap.set(core, canonicalName);
        muniMap.set(`${core} MUNICIPALITY`, canonicalName);
        muniMap.set(`MUNICIPALITY OF ${core}`, canonicalName);
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
        
        // Standardize municipality
        if (b.municipality) {
          const muniKey = b.municipality.trim().toUpperCase();
          if (muniMap.has(muniKey)) {
            b.municipality = muniMap.get(muniKey);
          }
        }

        // Standardize province
        if (b.province) {
          const provinceKey = b.province.trim().toUpperCase();
          if (provinceStandardMap.has(provinceKey)) {
            b.province = provinceStandardMap.get(provinceKey);
          }
        }

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
        $or: chunk.map(b => {
           const muniVal = (b.municipality || '').trim();
           const cityMatch = muniVal.match(/^(city of\s+)?(.+?)(\s+city)?(\s*\(.+?\))?$/i);
           const muniMatch = muniVal.match(/^(municipality of\s+)?(.+?)(\s+municipality)?(\s*\(.+?\))?$/i);
           const core = (cityMatch?.[2] || muniMatch?.[2] || muniVal).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
           const muniPattern = `^((city of\\s+)?${core}(\\s+city)?|(municipality of\\s+)?${core}(\\s+municipality)?)(\\s*\\(.+?\\))?$`;

           return {
            first_name: { $regex: new RegExp(`^${(b.first_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            last_name: { $regex: new RegExp(`^${(b.last_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            middle_name: { $regex: new RegExp(`^${(b.middle_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            birthdate: b.birthdate || "",
            barangay: { $regex: new RegExp(`^${(b.barangay || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            municipality: { $regex: new RegExp(muniPattern, "i") },
            province: { $regex: new RegExp(`^${(b.province || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
          };
        })
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
    const user = (req as any).user;
    
    const query: any = { _id: req.params.id };
    if (user.role !== "admin") {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        query.$and = [areaFilter];
      } else {
        return next(new ErrorHandler("You are not assigned to any areas and cannot update beneficiaries", 403));
      }
    }

    const beneficiary = await Beneficiary.findOne(query);
    if (!beneficiary) {
      return next(new ErrorHandler("Beneficiary not found or you are not authorized to update it", 404));
    }

    // If area is being changed, check if the new area is also authorized
    if (user.role !== "admin" && (req.body.region || req.body.province || req.body.municipality || req.body.barangay)) {
      const assignedAreas = await Area.find({
        $or: [
          { _id: { $in: user.assigned_areas.map((a: any) => typeof a === 'object' ? a._id : a).filter((id: any) => id && id.toString().match(/^[0-9a-fA-F]{24}$/)) } },
          { name: { $in: user.assigned_areas.map((a: any) => typeof a === 'object' ? a.name : a) } }
        ]
      });

      const updatedData = { ...beneficiary.toObject(), ...req.body };
      
      const isMatch = assignedAreas.some(area => {
        const escapedName = area.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^${escapedName}$`, "i");
        if (area.type === 'region') return regex.test(updatedData.region || "");
        if (area.type === 'province') return regex.test(updatedData.province || "");
        if (area.type === 'municipality') return regex.test(updatedData.municipality || "");
        if (area.type === 'barangay') return regex.test(updatedData.barangay || "");
        return false;
      });

      if (!isMatch) {
        return next(new ErrorHandler("You are not authorized to move a beneficiary to this area", 403));
      }
    }

    // Standardize area names before saving
    await standardizeAreaNames(req.body);

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

    // Filter by user's assigned areas if not admin
    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        deleteQuery.$and = [areaFilter];
      }
    }

    if (all) {
      // If deleting all based on filters
      if (filters) {
        const filterConditions: any[] = [];
        
        if (filters.search) {
          filterConditions.push({
            $or: [
              { hhid: { $regex: filters.search, $options: "i" } },
              { pkno: { $regex: filters.search, $options: "i" } },
              { first_name: { $regex: filters.search, $options: "i" } },
              { last_name: { $regex: filters.search, $options: "i" } },
            ]
          });
        }
        
        if (filters.region && filters.region !== "all") {
          const escapedValue = (filters.region as string).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          filterConditions.push({ region: { $regex: new RegExp(`^${escapedValue}$`, "i") } });
        }
        if (filters.province && filters.province !== "all") {
          const escapedValue = (filters.province as string).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          filterConditions.push({ province: { $regex: new RegExp(`^${escapedValue}$`, "i") } });
        }
        if (filters.municipality && filters.municipality !== "all") {
            const val = (filters.municipality as string).trim();
            const cityMatch = val.match(/^(city of\s+)?(.+?)(\s+city)?(\s*\(.+?\))?$/i);
            const muniMatch = val.match(/^(municipality of\s+)?(.+?)(\s+municipality)?(\s*\(.+?\))?$/i);
            
            const core = (cityMatch?.[2] || muniMatch?.[2] || val).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = `^((city of\\s+)?${core}(\\s+city)?|(municipality of\\s+)?${core}(\\s+municipality)?)(\\s*\\(.+?\\))?$`;
            
            filterConditions.push({ municipality: { $regex: new RegExp(pattern, "i") } });
          }
        if (filters.barangay && filters.barangay !== "all") {
          const escapedValue = (filters.barangay as string).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          filterConditions.push({ barangay: { $regex: new RegExp(`^${escapedValue}$`, "i") } });
        }

        if (filterConditions.length > 0) {
          if (deleteQuery.$and) {
            deleteQuery.$and.push(...filterConditions);
          } else {
            deleteQuery.$and = filterConditions;
          }
        }
      }
    } else {
      // If deleting specific IDs
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return next(new ErrorHandler("No IDs provided for deletion", 400));
      }
      if (deleteQuery.$and) {
        deleteQuery.$and.push({ _id: { $in: ids } });
      } else {
        deleteQuery._id = { $in: ids };
      }
    }

    const result = await Beneficiary.deleteMany(deleteQuery);

    await logAudit(req, "BULK_DELETE", "beneficiaries", "multiple", "", `Deleted ${result.deletedCount} beneficiaries`);

    res.status(200).json({
      success: true,
      count: result.deletedCount,
    });
  }
);

