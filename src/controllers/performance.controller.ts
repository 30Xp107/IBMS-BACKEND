import { NextFunction, Request, Response } from "express";
import performanceModel from "../models/performance.model";
import { AuthRequest } from "../middleware/auth";
import dotenv from "dotenv";
import ErrorHandler from "../utils/ErrorHandler";
import { catchAsync } from "../utils/catchAsync";
dotenv.config();

export const rateEmployee = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { userId, rating, comment } = req.body;
    const rater = req.user;
    const rate = await performanceModel.create({
      userId,
      rating,
      comment,
      ratee: rater?._id,
    });
    res.status(201).json({ success: true, rate });
  }
);

export const getRate = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const [rates, countPerformance] = await Promise.all([
      performanceModel.find().populate("ratee", "name email"),
      performanceModel.countDocuments(),
    ]);
    res.json({ success: true, countPerformance, rates });
  }
);

export const editRate = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const performanceRate = req.body;

    const updatedPerformance = await performanceModel.findByIdAndUpdate(
      id,
      { $set: performanceRate },
      { new: true, runValidators: true }
    );

    if (!updatedPerformance)
      return next(new ErrorHandler("Performance not Found", 404));

    res.status(200).json({
      success: true,
      message: "Rate updated successfully",
      data: updatedPerformance,
    });
  }
);


