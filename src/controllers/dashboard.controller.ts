import { Request, Response } from "express";
import { Beneficiary } from "../models/beneficiary.model";
import { Redemption } from "../models/redemption.model";
import { NES } from "../models/nes.model";
import userModel from "../models/user.model";
import { catchAsync } from "../utils/catchAsync";
import { getAreaFilter } from "../utils/areaFilter";

export const getDashboardStats = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;

    // Build query based on user's assigned areas
    let beneficiaryQuery: any = {};
    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        beneficiaryQuery = areaFilter;
      }
    }

    const totalBeneficiaries = await Beneficiary.countDocuments(beneficiaryQuery);
    const totalRedemptions = await Redemption.countDocuments({});
    const totalNES = await NES.countDocuments({});

    // Get current month stats
    const now = new Date();
    const currentMonth = `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`;

    const monthRedemptions = await Redemption.countDocuments({ frm_period: currentMonth });
    const monthNES = await NES.countDocuments({ frm_period: currentMonth });

    // Attendance rates for current month
    const presentRedemptions = await Redemption.countDocuments({
      frm_period: currentMonth,
      attendance: "present",
    });
    const presentNES = await NES.countDocuments({
      frm_period: currentMonth,
      attendance: "present",
    });

    const stats: any = {
      total_beneficiaries: totalBeneficiaries,
      total_redemptions: totalRedemptions,
      total_nes: totalNES,
      current_month: currentMonth,
      month_redemptions: monthRedemptions,
      month_nes: monthNES,
      redemption_attendance_rate: monthRedemptions > 0
        ? Math.round((presentRedemptions / monthRedemptions) * 100 * 10) / 10
        : 0,
      nes_attendance_rate: monthNES > 0
        ? Math.round((presentNES / monthNES) * 100 * 10) / 10
        : 0,
      monthly_trends: []
    };

    // Get the earliest record date to determine the start of the range
    const firstRedemption = await Redemption.findOne({}).sort({ createdAt: 1 });
    const firstNES = await NES.findOne({}).sort({ createdAt: 1 });
    
    let startDate = new Date();
    if (firstRedemption || firstNES) {
      const dates = [];
      if (firstRedemption) dates.push(new Date(firstRedemption.createdAt));
      if (firstNES) dates.push(new Date(firstNES.createdAt));
      startDate = new Date(Math.min(...dates.map(d => d.getTime())));
    }

    // Set to start of month
    startDate.setDate(1);
    
    const allContinuousMonths = [];
    const currentDate = new Date();
    currentDate.setDate(1);

    let tempDate = new Date(startDate);
    while (tempDate <= currentDate) {
      allContinuousMonths.push(`${tempDate.toLocaleString("default", { month: "long" })} ${tempDate.getFullYear()}`);
      tempDate.setMonth(tempDate.getMonth() + 1);
    }

    // Get stats for each month
    for (const monthStr of allContinuousMonths) {
      const redemptions = await Redemption.countDocuments({ frm_period: monthStr });
      const nes = await NES.countDocuments({ frm_period: monthStr });
      
      const [month, year] = monthStr.split(" ");
      const date = new Date(`${month} 1, ${year}`);
      
      stats.monthly_trends.push({
        month: date.toLocaleString("default", { month: "short" }),
        fullName: monthStr,
        redemptions,
        nes
      });
    }

    if (user.role === "admin") {
      const pendingUsers = await userModel.countDocuments({ status: "pending" });
      stats.pending_users = pendingUsers;
    }

    res.status(200).json(stats);
  }
);

export const getRedemptionDashboardStats = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    let beneficiaryQuery: any = {};
    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        beneficiaryQuery = areaFilter;
      }
    }

    const totalRedemptions = await Redemption.countDocuments({});
    
    // Get stats by attendance
    const attendanceStats = await Redemption.aggregate([
      { $group: { _id: "$attendance", count: { $sum: 1 } } }
    ]);

    // Get stats by FRM period
    const periodStats = await Redemption.aggregate([
      { $group: { _id: "$frm_period", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 12 }
    ]);

    res.status(200).json({
      totalRedemptions,
      attendanceStats,
      periodStats
    });
  }
);

export const getNESDashboardStats = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    let beneficiaryQuery: any = {};
    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        beneficiaryQuery = areaFilter;
      }
    }

    const totalNES = await NES.countDocuments({});
    
    // Get stats by attendance
    const attendanceStats = await NES.aggregate([
      { $group: { _id: "$attendance", count: { $sum: 1 } } }
    ]);

    // Get stats by reason (top 5)
    const reasonStats = await NES.aggregate([
      { $match: { reason: { $ne: "" } } },
      { $group: { _id: "$reason", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    // Get stats by FRM period
    const periodStats = await NES.aggregate([
      { $group: { _id: "$frm_period", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 12 }
    ]);

    res.status(200).json({
      totalNES,
      attendanceStats,
      reasonStats,
      periodStats
    });
  }
);

