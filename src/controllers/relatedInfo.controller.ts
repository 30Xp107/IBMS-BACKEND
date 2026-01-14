import { NextFunction, Request, Response } from "express";
import relatedModel from "../models/relatedInfo.model";
import ErrorHandler from "../utils/ErrorHandler";
import dotenv from "dotenv";
import { catchAsync } from "../utils/catchAsync";
import { logAudit } from "../utils/auditLogger";
dotenv.config();

export const assignInfo = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { userId, status, program, division } = req.body;
    const userAdmin = (req as any).user;

    const userIdExist = await relatedModel.findOne({ userId });
    if (userIdExist)
      return next(new ErrorHandler("Employee already exists", 400));

    const assignInf = await relatedModel.create({
      userId,
      status,
      program,
      division,
      assign: userAdmin?._id,
    });

    await logAudit(req, "CREATE", "related_info", assignInf.id, "", JSON.stringify(assignInf));

    res.status(201).json({
      success: true,
      message: "Successfully Added Information",
      assignInf,
    });
  }
);

export const getRelatedInfo = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const relatedInfo = await relatedModel
      .find()
      .populate("userId", "name email")
      .populate("assign", "name email");
    const countInfo = await relatedModel.countDocuments();
    res.status(200).json({ success: true, countInfo, relatedInfo });
  }
);

export const updateInfo = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const Id = req.params.id;
    const { userId, status, program, division } = req.body;

    const existingInfo = await relatedModel.findById(Id);
    if (!existingInfo) return next(new ErrorHandler("Record not found", 404));

    const oldData = JSON.stringify(existingInfo);

    const updatedInfo = await relatedModel
      .findByIdAndUpdate(
        Id,
        { $set: { userId, status, program, division } },
        { new: true, runValidators: true }
      )
      .populate("assign", "name email");
    
    if (!updatedInfo) return next(new ErrorHandler("Record not found", 400));

    await logAudit(req, "UPDATE", "related_info", updatedInfo.id, oldData, JSON.stringify(updatedInfo));

    res.status(200).json({
      success: true,
      message: "Successfully Updated Information",
      updateInfo: updatedInfo,
    });
  }
);

export const deleteInfo = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const Id = req.params.id;
    if (!Id) return next(new ErrorHandler("Id not found", 404));
    
    const existingInfo = await relatedModel.findById(Id);
    if (!existingInfo) return next(new ErrorHandler("Information not found", 404));

    const oldData = JSON.stringify(existingInfo);
    const deletedInfo = await relatedModel.findByIdAndDelete(Id);
    
    await logAudit(req, "DELETE", "related_info", Id, oldData, "");

    res.status(200).json({
      success: true,
      message: "Successfully Deleted Information",
      deletedInfo,
    });
  }
);


