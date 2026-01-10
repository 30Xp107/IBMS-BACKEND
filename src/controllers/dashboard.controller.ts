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
    const totalBeneficiaries = await Beneficiary.countDocuments(beneficiaryQuery);
    
    // Get stats by attendance
    const attendanceStats = await Redemption.aggregate([
      { $group: { _id: "$attendance", count: { $sum: 1 } } }
    ]);

    // Get stats by FRM period with target vs validated vs unredeemed
    const periodStatsRaw = await Redemption.aggregate([
      {
        $group: {
          _id: "$frm_period",
          redeemed: {
            $sum: { $cond: [{ $eq: ["$attendance", "present"] }, 1, 0] }
          },
          unredeemed: {
            $sum: { $cond: [{ $eq: ["$attendance", "absent"] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 12 }
    ]);

    const periodStats = periodStatsRaw.map(p => {
      const redeemed = p.redeemed || 0;
      const unredeemed = p.unredeemed || 0;
      return {
        period: p._id,
        redeemed,
        unredeemed,
        remaining: totalBeneficiaries - redeemed - unredeemed,
        target: totalBeneficiaries
      };
    });

    // Get current month for municipality breakdown
    const now = new Date();
    const currentMonth = `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`;

    // Get municipality breakdown (Target vs Validated)
    // 1. Get targets (all beneficiaries per municipality)
    const targets = await Beneficiary.aggregate([
      { $match: beneficiaryQuery },
      { $group: { _id: "$municipality", target: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // 2. Get recorded (redemptions for current month per municipality)
    const recorded = await Redemption.aggregate([
      { $match: { frm_period: currentMonth } },
      {
        $addFields: {
          beneficiaryObjectId: { $toObjectId: "$beneficiary_id" }
        }
      },
      {
        $lookup: {
          from: "beneficiaries",
          localField: "beneficiaryObjectId",
          foreignField: "_id",
          as: "beneficiary"
        }
      },
      { $unwind: "$beneficiary" },
      // Apply the same beneficiaryQuery filters if any
      { 
        $match: Object.keys(beneficiaryQuery).reduce((acc: any, key) => {
          acc[`beneficiary.${key}`] = beneficiaryQuery[key];
          return acc;
        }, {})
      },
      {
        $group: {
          _id: "$beneficiary.municipality",
          redeemed: {
            $sum: { $cond: [{ $eq: ["$attendance", "present"] }, 1, 0] }
          },
          unredeemed: {
            $sum: { $cond: [{ $eq: ["$attendance", "absent"] }, 1, 0] }
          }
        }
      }
    ]);

    // Merge targets and recorded
    const municipalityBreakdown = targets.map(t => {
      const rec = recorded.find(r => r._id === t._id);
      const redeemed = rec ? rec.redeemed : 0;
      const unredeemed = rec ? rec.unredeemed : 0;
      return {
        municipality: t._id || "Unknown",
        target: t.target,
        redeemed,
        unredeemed,
        remaining: t.target - redeemed - unredeemed
      };
    });

    res.status(200).json({
      totalRedemptions,
      attendanceStats,
      periodStats,
      municipalityBreakdown
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
    const totalBeneficiaries = await Beneficiary.countDocuments(beneficiaryQuery);
    
    // Get stats by attendance
    const attendanceStats = await NES.aggregate([
      { $group: { _id: "$attendance", count: { $sum: 1 } } }
    ]);

    // Get stats by top reasons for non-attendance
    const reasonStats = await NES.aggregate([
      { $match: { attendance: "absent", reason: { $ne: "" } } },
      { $group: { _id: "$reason", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    // Get stats by FRM period with target vs attended vs absent
    const periodStatsRaw = await NES.aggregate([
      {
        $group: {
          _id: "$frm_period",
          attended: {
            $sum: { $cond: [{ $eq: ["$attendance", "present"] }, 1, 0] }
          },
          absent: {
            $sum: { $cond: [{ $eq: ["$attendance", "absent"] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 12 }
    ]);

    const periodStats = periodStatsRaw.map(p => {
      const attended = p.attended || 0;
      const absent = p.absent || 0;
      return {
        period: p._id,
        attended,
        absent,
        remaining: totalBeneficiaries - attended - absent,
        target: totalBeneficiaries
      };
    });

    // Get current month for municipality breakdown
    const now = new Date();
    const currentMonth = `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`;

    // Get municipality breakdown (Target vs Attended vs Absent)
    // 1. Get targets (all beneficiaries per municipality)
    const targets = await Beneficiary.aggregate([
      { $match: beneficiaryQuery },
      { $group: { _id: "$municipality", target: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // 2. Get recorded (NES records for current month per municipality)
    const recorded = await NES.aggregate([
      { $match: { frm_period: currentMonth } },
      {
        $addFields: {
          beneficiaryObjectId: { $toObjectId: "$beneficiary_id" }
        }
      },
      {
        $lookup: {
          from: "beneficiaries",
          localField: "beneficiaryObjectId",
          foreignField: "_id",
          as: "beneficiary"
        }
      },
      { $unwind: "$beneficiary" },
      // Apply the same beneficiaryQuery filters if any
      { 
        $match: Object.keys(beneficiaryQuery).reduce((acc: any, key) => {
          acc[`beneficiary.${key}`] = beneficiaryQuery[key];
          return acc;
        }, {})
      },
      {
        $group: {
          _id: "$beneficiary.municipality",
          attended: {
            $sum: { $cond: [{ $eq: ["$attendance", "present"] }, 1, 0] }
          },
          absent: {
            $sum: { $cond: [{ $eq: ["$attendance", "absent"] }, 1, 0] }
          }
        }
      }
    ]);

    // Merge targets and recorded
    const municipalityBreakdown = targets.map(t => {
      const rec = recorded.find(r => r._id === t._id);
      const attended = rec ? rec.attended : 0;
      const absent = rec ? rec.absent : 0;
      return {
        municipality: t._id || "Unknown",
        target: t.target,
        attended,
        absent,
        remaining: t.target - attended - absent
      };
    });

    res.status(200).json({
      totalNES,
      attendanceStats,
      periodStats,
      reasonStats,
      municipalityBreakdown
    });
  }
);

