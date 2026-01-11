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
    const { province, municipality } = req.query;

    // Build query based on user's assigned areas
    let beneficiaryQuery: any = { status: "Active" };
    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        beneficiaryQuery = { ...beneficiaryQuery, ...areaFilter };
      }
    }

    // Additional filters from dropdowns
    if (province) {
      beneficiaryQuery.province = { $regex: new RegExp(`^\\s*${province.toString().trim()}\\s*$`, "i") };
    }
    if (municipality) {
      beneficiaryQuery.municipality = { $regex: new RegExp(`^\\s*${municipality.toString().trim()}\\s*$`, "i") };
    }

    // Filter aggregation helper for redemptions/NES
    const getFilteredCount = async (model: any, additionalQuery: any = {}) => {
      const aggregation = [
        {
          $lookup: {
            from: "beneficiaries",
            let: { hhid: "$hhid" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [
                      { $toUpper: { $trim: { input: "$hhid" } } },
                      { $toUpper: { $trim: { input: "$$hhid" } } }
                    ]
                  }
                }
              }
            ],
            as: "beneficiary"
          }
        },
        { $unwind: "$beneficiary" },
        { 
          $match: {
            ...additionalQuery,
            ...Object.keys(beneficiaryQuery).reduce((acc: any, key) => {
              acc[`beneficiary.${key}`] = beneficiaryQuery[key];
              return acc;
            }, {})
          }
        },
        // Unique per HHID and period (if period is in query) or just unique per HHID/period overall
        {
          $group: {
            _id: { hhid: "$hhid", period: "$frm_period" }
          }
        },
        { $count: "total" }
      ];
      const result = await model.aggregate(aggregation);
      return result[0]?.total || 0;
    };

    const totalBeneficiaries = await Beneficiary.countDocuments(beneficiaryQuery);
    const totalRedemptions = await getFilteredCount(Redemption);
    const totalNES = await getFilteredCount(NES);

    // Get current month stats
    const now = new Date();
    const currentMonth = `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`;

    const monthRedemptions = await getFilteredCount(Redemption, { frm_period: currentMonth });
    const monthNES = await getFilteredCount(NES, { frm_period: currentMonth });

    // Attendance rates for current month
    const presentRedemptions = await getFilteredCount(Redemption, {
      frm_period: currentMonth,
      attendance: "present",
    });
    const presentNES = await getFilteredCount(NES, {
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
      const redemptions = await getFilteredCount(Redemption, { frm_period: monthStr });
      const nes = await getFilteredCount(NES, { frm_period: monthStr });
      
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
    const { year, month, province, municipality } = req.query;

    let targetPeriod: string;
    if (year && month) {
      targetPeriod = `${month} ${year}`;
    } else {
      const now = new Date();
      targetPeriod = `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`;
    }

    let beneficiaryQuery: any = { status: "Active" };
    
    // User's assigned area restrictions
    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        beneficiaryQuery = { ...beneficiaryQuery, ...areaFilter };
      }
    }

    // Additional filters from dropdowns
    if (province) {
      beneficiaryQuery.province = { $regex: new RegExp(`^\\s*${province.toString().trim()}\\s*$`, "i") };
    }
    if (municipality) {
      beneficiaryQuery.municipality = { $regex: new RegExp(`^\\s*${municipality.toString().trim()}\\s*$`, "i") };
    }

    // Filter redemptions by area using a join with Beneficiary collection
    const filteredRedemptionsAggregation = [
      {
        $lookup: {
          from: "beneficiaries",
          let: { redemptionHhid: "$hhid" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [
                    { $toUpper: { $trim: { input: "$hhid" } } },
                    { $toUpper: { $trim: { input: "$$redemptionHhid" } } }
                  ]
                }
              }
            }
          ],
          as: "beneficiary"
        }
      },
      { $unwind: "$beneficiary" },
      { 
        $match: Object.keys(beneficiaryQuery).reduce((acc: any, key) => {
          acc[`beneficiary.${key}`] = beneficiaryQuery[key];
          return acc;
        }, {})
      }
    ];

    const totalRedemptionsResult = await Redemption.aggregate([
      ...filteredRedemptionsAggregation,
      { $count: "total" }
    ]);
    const totalRedemptions = totalRedemptionsResult[0]?.total || 0;
    const totalBeneficiaries = await Beneficiary.countDocuments(beneficiaryQuery);
    
    // Get stats by attendance (Filtered for target period)
    const attendanceStats = await Redemption.aggregate([
      { $match: { frm_period: targetPeriod } },
      ...filteredRedemptionsAggregation,
      {
        $group: {
          _id: "$hhid",
          attendance: { $first: "$attendance" }
        }
      },
      { $group: { _id: "$attendance", count: { $sum: 1 } } }
    ]);

    // Get stats by FRM period (Filtered - last 12 periods)
    const periodStatsRaw = await Redemption.aggregate([
      ...filteredRedemptionsAggregation,
      {
        $group: {
          _id: { hhid: "$hhid", period: "$frm_period" },
          attendance: { $first: "$attendance" }
        }
      },
      {
        $group: {
          _id: "$_id.period",
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
      const remaining = totalBeneficiaries - redeemed - unredeemed;
      return {
        period: p._id,
        redeemed,
        unredeemed,
        remaining: remaining > 0 ? remaining : 0,
        target: totalBeneficiaries
      };
    });

    // Get municipality breakdown (Target vs Validated) for the target period
    // 1. Get targets (all beneficiaries per municipality)
    const targets = await Beneficiary.aggregate([
      { $match: beneficiaryQuery },
      {
        $group: {
          _id: {
            municipality: { $toUpper: { $trim: { input: "$municipality" } } },
            province: { $toUpper: { $trim: { input: "$province" } } }
          },
          target: { $sum: 1 }
        }
      },
      { $sort: { "_id.municipality": 1 } }
    ]);

    // 2. Get recorded (redemptions for target period per municipality)
    const recorded = await Redemption.aggregate([
      { $match: { frm_period: targetPeriod } },
      ...filteredRedemptionsAggregation,
      {
        $group: {
          _id: "$hhid",
          attendance: { $first: "$attendance" },
          municipality: { $first: "$beneficiary.municipality" },
          province: { $first: "$beneficiary.province" }
        }
      },
      {
        $group: {
          _id: {
            municipality: { $toUpper: { $trim: { input: "$municipality" } } },
            province: { $toUpper: { $trim: { input: "$province" } } }
          },
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
      const rec = recorded.find(r => r._id.municipality === t._id.municipality && r._id.province === t._id.province);
      const redeemed = rec ? rec.redeemed : 0;
      const unredeemed = rec ? rec.unredeemed : 0;
      const remaining = t.target - redeemed - unredeemed;
      return {
        municipality: t._id.municipality || "Unknown",
        province: t._id.province || "Unknown",
        target: t.target,
        redeemed,
        unredeemed,
        remaining: remaining > 0 ? remaining : 0
      };
    });

    // Get province breakdown (Target vs Validated) for the target period
    // 1. Get targets (all beneficiaries per province)
    const provinceTargets = await Beneficiary.aggregate([
      { $match: beneficiaryQuery },
      {
        $group: {
          _id: { $toUpper: { $trim: { input: "$province" } } },
          target: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // 2. Get recorded (redemptions for target period per province)
    const provinceRecorded = await Redemption.aggregate([
      { $match: { frm_period: targetPeriod } },
      ...filteredRedemptionsAggregation,
      {
        $group: {
          _id: "$hhid",
          attendance: { $first: "$attendance" },
          province: { $first: "$beneficiary.province" }
        }
      },
      {
        $group: {
          _id: { $toUpper: { $trim: { input: "$province" } } },
          redeemed: {
            $sum: { $cond: [{ $eq: ["$attendance", "present"] }, 1, 0] }
          },
          unredeemed: {
            $sum: { $cond: [{ $eq: ["$attendance", "absent"] }, 1, 0] }
          }
        }
      }
    ]);

    const provinceBreakdown = provinceTargets.map(t => {
      const rec = provinceRecorded.find(r => r._id === t._id);
      const redeemed = rec ? rec.redeemed : 0;
      const unredeemed = rec ? rec.unredeemed : 0;
      const remaining = t.target - redeemed - unredeemed;
      return {
        province: t._id || "Unknown",
        target: t.target,
        redeemed,
        unredeemed,
        remaining: remaining > 0 ? remaining : 0
      };
    });

    res.status(200).json({
      totalRedemptions,
      attendanceStats,
      periodStats,
      municipalityBreakdown,
      provinceBreakdown
    });
  }
);

export const getNESDashboardStats = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { year, month, province, municipality } = req.query;

    let targetPeriod: string;
    if (year && month) {
      targetPeriod = `${month} ${year}`;
    } else {
      const now = new Date();
      targetPeriod = `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`;
    }

    let beneficiaryQuery: any = { status: "Active" };
    
    // User's assigned area restrictions
    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        beneficiaryQuery = { ...beneficiaryQuery, ...areaFilter };
      }
    }

    // Additional filters from dropdowns
    if (province) {
      beneficiaryQuery.province = { $regex: new RegExp(`^\\s*${province.toString().trim()}\\s*$`, "i") };
    }
    if (municipality) {
      beneficiaryQuery.municipality = { $regex: new RegExp(`^\\s*${municipality.toString().trim()}\\s*$`, "i") };
    }

    // Filter NES records by area using a join with Beneficiary collection
    const filteredNESAggregation = [
      {
        $lookup: {
          from: "beneficiaries",
          let: { nesHhid: "$hhid" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [
                    { $toUpper: { $trim: { input: "$hhid" } } },
                    { $toUpper: { $trim: { input: "$$nesHhid" } } }
                  ]
                }
              }
            }
          ],
          as: "beneficiary"
        }
      },
      { $unwind: "$beneficiary" },
      { 
        $match: Object.keys(beneficiaryQuery).reduce((acc: any, key) => {
          acc[`beneficiary.${key}`] = beneficiaryQuery[key];
          return acc;
        }, {})
      }
    ];

    const totalNESResult = await NES.aggregate([
      ...filteredNESAggregation,
      { $count: "total" }
    ]);
    const totalNES = totalNESResult[0]?.total || 0;
    const totalBeneficiaries = await Beneficiary.countDocuments(beneficiaryQuery);
    
    // Get stats by attendance (Filtered for target period)
    const attendanceStats = await NES.aggregate([
      { $match: { frm_period: targetPeriod } },
      ...filteredNESAggregation,
      {
        $group: {
          _id: "$hhid",
          attendance: { $first: "$attendance" }
        }
      },
      { $group: { _id: "$attendance", count: { $sum: 1 } } }
    ]);

    // Get stats by top reasons for non-attendance (Filtered for target period)
    const reasonStats = await NES.aggregate([
      { $match: { frm_period: targetPeriod, attendance: "absent", reason: { $ne: "" } } },
      ...filteredNESAggregation,
      {
        $group: {
          _id: "$hhid",
          reason: { $first: "$reason" }
        }
      },
      { $group: { _id: "$reason", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    // Get stats by FRM period (Filtered - last 12 periods)
    const periodStatsRaw = await NES.aggregate([
      ...filteredNESAggregation,
      {
        $group: {
          _id: { hhid: "$hhid", period: "$frm_period" },
          attendance: { $first: "$attendance" }
        }
      },
      {
        $group: {
          _id: "$_id.period",
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
      const remaining = totalBeneficiaries - attended - absent;
      return {
        period: p._id,
        attended,
        absent,
        remaining: remaining > 0 ? remaining : 0,
        target: totalBeneficiaries
      };
    });

    // Get municipality breakdown (Target vs Attended vs Absent) for the target period
    // 1. Get targets (all beneficiaries per municipality)
    const targets = await Beneficiary.aggregate([
      { $match: beneficiaryQuery },
      {
        $group: {
          _id: {
            municipality: { $toUpper: { $trim: { input: "$municipality" } } },
            province: { $toUpper: { $trim: { input: "$province" } } }
          },
          target: { $sum: 1 }
        }
      },
      { $sort: { "_id.municipality": 1 } }
    ]);

    // 2. Get recorded (NES records for target period per municipality)
    const recorded = await NES.aggregate([
      { $match: { frm_period: targetPeriod } },
      ...filteredNESAggregation,
      {
        $group: {
          _id: "$hhid",
          attendance: { $first: "$attendance" },
          municipality: { $first: "$beneficiary.municipality" },
          province: { $first: "$beneficiary.province" }
        }
      },
      {
        $group: {
          _id: {
            municipality: { $toUpper: { $trim: { input: "$municipality" } } },
            province: { $toUpper: { $trim: { input: "$province" } } }
          },
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
      const rec = recorded.find(r => r._id.municipality === t._id.municipality && r._id.province === t._id.province);
      const attended = rec ? rec.attended : 0;
      const absent = rec ? rec.absent : 0;
      const remaining = t.target - attended - absent;
      return {
        municipality: t._id.municipality || "Unknown",
        province: t._id.province || "Unknown",
        target: t.target,
        attended,
        absent,
        remaining: remaining > 0 ? remaining : 0
      };
    });

    // Get province breakdown (Target vs Attended vs Absent) for the target period
    // 1. Get targets (all beneficiaries per province)
    const provinceTargets = await Beneficiary.aggregate([
      { $match: beneficiaryQuery },
      {
        $group: {
          _id: { $toUpper: { $trim: { input: "$province" } } },
          target: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // 2. Get recorded (NES records for target period per province)
    const provinceRecorded = await NES.aggregate([
      { $match: { frm_period: targetPeriod } },
      ...filteredNESAggregation,
      {
        $group: {
          _id: "$hhid",
          attendance: { $first: "$attendance" },
          province: { $first: "$beneficiary.province" }
        }
      },
      {
        $group: {
          _id: { $toUpper: { $trim: { input: "$province" } } },
          attended: {
            $sum: { $cond: [{ $eq: ["$attendance", "present"] }, 1, 0] }
          },
          absent: {
            $sum: { $cond: [{ $eq: ["$attendance", "absent"] }, 1, 0] }
          }
        }
      }
    ]);

    const provinceBreakdown = provinceTargets.map(t => {
      const rec = provinceRecorded.find(r => r._id === t._id);
      const attended = rec ? rec.attended : 0;
      const absent = rec ? rec.absent : 0;
      const remaining = t.target - attended - absent;
      return {
        province: t._id || "Unknown",
        target: t.target,
        attended,
        absent,
        remaining: remaining > 0 ? remaining : 0
      };
    });

    res.status(200).json({
      totalNES,
      attendanceStats,
      periodStats,
      reasonStats,
      municipalityBreakdown,
      provinceBreakdown
    });
  }
);

