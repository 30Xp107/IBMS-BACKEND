import { Request, Response, NextFunction } from "express";
import { SystemConfig } from "../models/systemConfig.model";
import { catchAsync } from "../utils/catchAsync";
import ErrorHandler from "../utils/ErrorHandler";
import { logAudit } from "../utils/auditLogger";

// Get configuration by key
export const getConfig = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { key } = req.params;
    let config = await SystemConfig.findOne({ key });

    // Provide default values if not found
    if (!config && key === "beneficiary_import_requirements") {
      config = await SystemConfig.create({
        key,
        value: {
          hhid: true,
          pkno: false,
          first_name: true,
          last_name: true,
          birthdate: false,
          gender: false,
          barangay: false,
          municipality: false,
          province: false,
          region: false,
        },
        description: "Required fields for beneficiary import",
        updatedBy: (req as any).user._id,
      });
    }

    if (!config) {
      return next(new ErrorHandler("Configuration not found", 404));
    }

    res.status(200).json(config);
  }
);

// Update configuration
export const updateConfig = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { key } = req.params;
    const { value } = req.body;

    let config = await SystemConfig.findOne({ key });

    if (!config) {
      config = new SystemConfig({
        key,
        value,
        updatedBy: (req as any).user._id,
      });
    } else {
      const oldVal = JSON.stringify(config.value);
      config.value = value;
      config.updatedBy = (req as any).user._id;
      await logAudit(req, "UPDATE", "system_configs", config.id, oldVal, JSON.stringify(value));
    }

    await config.save();
    res.status(200).json(config);
  }
);
