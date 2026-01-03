import { Request, Response } from "express";
import { AuditLog } from "../models/auditLog.model";
import { catchAsync } from "../utils/catchAsync";

export const getAuditLogs = catchAsync(
  async (req: Request, res: Response) => {
    const { module, user_id, limit = 100 } = req.query;

    const query: any = {};
    if (module) query.module = module;
    if (user_id) query.user_id = user_id;

    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    res.status(200).json(logs);
  }
);

