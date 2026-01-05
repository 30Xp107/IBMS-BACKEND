import { Request, Response } from "express";
import { AuditLog } from "../models/auditLog.model";
import { catchAsync } from "../utils/catchAsync";

export const getAuditLogs = catchAsync(
  async (req: Request, res: Response) => {
    const { module, user_id, page = 1, limit = 50, search } = req.query;

    const query: any = {};
    if (module) query.module = module;
    if (user_id) query.user_id = user_id;
    
    if (search) {
      query.$or = [
        { user_name: { $regex: search as string, $options: "i" } },
        { action: { $regex: search as string, $options: "i" } },
        { module: { $regex: search as string, $options: "i" } },
        { record_id: { $regex: search as string, $options: "i" } }
      ];
    }

    if (limit === "all") {
      const logs = await AuditLog.find(query).sort({ createdAt: -1 });
      return res.status(200).json({ logs, total: logs.length });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      AuditLog.countDocuments(query)
    ]);

    res.status(200).json({
      logs,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    });
  }
);

