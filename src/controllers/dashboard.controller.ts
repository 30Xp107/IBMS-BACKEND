import { Request, Response } from "express";
import { Beneficiary } from "../models/beneficiary.model";
import { Redemption } from "../models/redemption.model";
import { NES } from "../models/nes.model";
import userModel from "../models/user.model";
import { SystemConfig } from "../models/systemConfig.model";
import { catchAsync } from "../utils/catchAsync";
import { getAreaFilter } from "../utils/areaFilter";
import { getFrmPeriod } from "../utils/frmHelpers";

/**
 * Helper to prefix all keys in a query object for aggregation matches after a lookup.
 * Correctiy handles nested $or, $and, and $nor operators.
 */
const prefixQueryKeys = (query: any, prefix: string): any => {
  if (!query || typeof query !== 'object') return query;
  
  const prefixed: any = {};
  for (const key in query) {
    if (key === "$or" || key === "$and" || key === "$nor") {
      if (Array.isArray(query[key])) {
        prefixed[key] = query[key].map((subQuery: any) => prefixQueryKeys(subQuery, prefix));
      } else {
        prefixed[key] = query[key];
      }
    } else if (key.startsWith("$")) {
      // Other operators like $expr, $match etc. at top level - keep as is
      prefixed[key] = query[key];
    } else {
      prefixed[`${prefix}.${key}`] = query[key];
    }
  }
  return prefixed;
};

const escapeRegex = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

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
      beneficiaryQuery.province = { $regex: new RegExp(`^\\s*${escapeRegex(province.toString().trim())}\\s*$`, "i") };
    }
    if (municipality) {
      beneficiaryQuery.municipality = { $regex: new RegExp(`^\\s*${escapeRegex(municipality.toString().trim())}\\s*$`, "i") };
    }

    // Fetch beneficiary IDs and HHIDs once for all subsequent queries
    const beneficiaries = await Beneficiary.find(beneficiaryQuery).select("_id hhid").lean();
    const beneficiaryIdList = beneficiaries.map(b => b._id.toString());
    const hhidList = beneficiaries.map(b => b.hhid).filter(h => !!h);

    // Filter aggregation helper for redemptions/NES
    const getFilteredCount = async (model: any, additionalQuery: any = {}) => {
      if (beneficiaryIdList.length === 0) return 0;

      // Convert string IDs to ObjectIds for matching if needed
      const beneficiaryIdObjs = beneficiaryIdList.map(id => {
        try {
          return new (require('mongoose').Types.ObjectId)(id);
        } catch (e) {
          return null;
        }
      }).filter(id => id !== null);

      const aggregation = [
        {
          $match: {
            ...additionalQuery,
            $or: [
              { beneficiary_id: { $in: beneficiaryIdList } },
              { beneficiary_id: { $in: beneficiaryIdObjs } },
              { hhid: { $in: hhidList } }
            ]
          }
        },
        // Normalize beneficiary_id for grouping
        {
          $addFields: {
            norm_beneficiary_id: {
              $cond: {
                if: { $eq: [{ $type: "$beneficiary_id" }, "objectId"] },
                then: "$beneficiary_id",
                else: {
                  $cond: {
                    if: { $and: [
                      { $ne: ["$beneficiary_id", ""] },
                      { $ne: ["$beneficiary_id", null] },
                      { $eq: [{ $type: "$beneficiary_id" }, "string"] },
                      { $eq: [{ $strLenCP: "$beneficiary_id" }, 24] }
                    ]},
                    then: { $toObjectId: "$beneficiary_id" },
                    else: "$beneficiary_id"
                  }
                }
              }
            }
          }
        },
        // Unique per beneficiary and period
        {
          $group: {
            _id: { beneficiary_id: "$norm_beneficiary_id", period: "$frm_period" }
          }
        },
        { $count: "total" }
      ];
      const result = await model.aggregate(aggregation);
      return result[0]?.total || 0;
    };

    const [
      totalBeneficiaries,
      totalRedemptions,
      totalNES,
      currentPeriod
    ] = await Promise.all([
      Beneficiary.countDocuments(beneficiaryQuery),
      getFilteredCount(Redemption),
      getFilteredCount(NES),
      getFrmPeriod()
    ]);

    // Get current FRM period stats
    const escapedCurrentPeriod = escapeRegex(currentPeriod.trim());
    const currentPeriodMatch = { $regex: new RegExp(`^\\s*${escapedCurrentPeriod}\\s*$`, "i") };

    const [
      monthRedemptions,
      monthNES,
      presentRedemptions,
      presentNES
    ] = await Promise.all([
      getFilteredCount(Redemption, { frm_period: currentPeriodMatch }),
      getFilteredCount(NES, { frm_period: currentPeriodMatch }),
      getFilteredCount(Redemption, {
        frm_period: currentPeriodMatch,
        attendance: { $in: ["present", "redeemed"] },
      }),
      getFilteredCount(NES, {
        frm_period: currentPeriodMatch,
        attendance: { $in: ["present", "redeemed"] },
      })
    ]);

    const stats: any = {
      total_beneficiaries: totalBeneficiaries,
      total_redemptions: totalRedemptions,
      total_nes: totalNES,
      current_month: currentPeriod,
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

    // Get the unique FRM periods from the database for trends
    const [redemptionPeriods, nesPeriods] = await Promise.all([
      Redemption.distinct("frm_period"),
      NES.distinct("frm_period")
    ]);

    const allPeriodsSet = new Set<string>([...redemptionPeriods, ...nesPeriods]);
    
    // Add custom schedules to the set if not already present
    try {
      const config = await SystemConfig.findOne({ key: "frm_schedules" });
      if (config && Array.isArray(config.value)) {
        config.value.forEach((s: any) => allPeriodsSet.add(s.name));
      }
    } catch (error) {
      console.error("Error fetching FRM schedules for dashboard trends:", error);
    }

    // Convert set to array and filter out empty values
    const allPeriods = Array.from(allPeriodsSet).filter(p => !!p);

    // Sort periods - this is tricky without a date. 
    // For now, we'll try to sort them. Monthly ones usually sort okay.
    // Custom ones like "FRM 1" might need special handling.
    // For a better experience, we'll sort them and take the last 12.
    const sortedPeriods = allPeriods.sort((a, b) => b.localeCompare(a)).slice(0, 12).reverse();

    // Get stats for each period
    for (const periodStr of sortedPeriods) {
      const redemptions = await getFilteredCount(Redemption, { frm_period: periodStr });
      const nes = await getFilteredCount(NES, { frm_period: periodStr });
      
      stats.monthly_trends.push({
        month: periodStr,
        fullName: periodStr,
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
    const { year, month, period, province, municipality } = req.query;

    let targetPeriod: string;
    if (period) {
      targetPeriod = period.toString();
    } else if (year && month) {
      targetPeriod = `${month} ${year}`;
    } else {
      targetPeriod = await getFrmPeriod();
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
      beneficiaryQuery.province = { $regex: new RegExp(`^\\s*${escapeRegex(province.toString().trim())}\\s*$`, "i") };
    }
    if (municipality) {
      beneficiaryQuery.municipality = { $regex: new RegExp(`^\\s*${escapeRegex(municipality.toString().trim())}\\s*$`, "i") };
    }

    // Filter redemptions by area using a join with Beneficiary collection
    const filteredRedemptionsAggregation = [
      {
        $addFields: {
          beneficiary_id_obj: {
            $cond: {
              if: { $eq: [{ $type: "$beneficiary_id" }, "objectId"] },
              then: "$beneficiary_id",
              else: {
                $cond: {
                  if: { $and: [
                    { $ne: ["$beneficiary_id", ""] },
                    { $ne: ["$beneficiary_id", null] },
                    { $eq: [{ $type: "$beneficiary_id" }, "string"] },
                    { $eq: [{ $strLenCP: "$beneficiary_id" }, 24] }
                  ]},
                  then: { $toObjectId: "$beneficiary_id" },
                  else: null
                }
              }
            }
          },
          norm_beneficiary_id: { $toString: "$beneficiary_id" }
        }
      },
      {
        $lookup: {
          from: "beneficiaries",
          let: { b_id: "$beneficiary_id_obj", h_id: "$hhid", b_id_str: "$norm_beneficiary_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$_id", "$$b_id"] },
                    { $eq: [{ $toString: "$_id" }, "$$b_id_str"] },
                    { 
                      $and: [
                        { $ne: ["$$h_id", ""] },
                        { $ne: ["$$h_id", null] },
                        { $eq: ["$hhid", "$$h_id"] }
                      ]
                    }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: "beneficiary"
        }
      },
      { $unwind: "$beneficiary" },
      { $match: prefixQueryKeys(beneficiaryQuery, "beneficiary") }
    ];

    const totalRedemptionsResult = await Redemption.aggregate([
      ...filteredRedemptionsAggregation,
      {
        $group: {
          _id: { beneficiary_id: "$beneficiary._id", period: "$frm_period" }
        }
      },
      { $count: "total" }
    ]);
    const totalRedemptions = totalRedemptionsResult[0]?.total || 0;
    const totalBeneficiaries = await Beneficiary.countDocuments(beneficiaryQuery);
    
    // Escape regex special characters in the period name (like parentheses)
    const escapedPeriod = escapeRegex(targetPeriod.trim());
    const periodMatch = { 
      frm_period: { $regex: new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i") } 
    };

    // Get stats by attendance (Filtered for target period)
    const attendanceStats = await Redemption.aggregate([
      { $match: periodMatch },
      ...filteredRedemptionsAggregation,
      {
        $group: {
          _id: "$beneficiary._id",
          attendance: { $first: "$attendance" }
        }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $in: ["$attendance", ["present", "redeemed"]] },
              "present",
              {
                $cond: [
                  { $in: ["$attendance", ["absent", "unredeemed"]] },
                  "absent",
                  "none"
                ]
              }
            ]
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get stats by FRM period (Filtered - last 12 periods)
    const periodStatsRaw = await Redemption.aggregate([
      ...filteredRedemptionsAggregation,
      {
        $group: {
          _id: { beneficiary_id: "$beneficiary._id", period: "$frm_period" },
          attendance: { $first: "$attendance" }
        }
      },
      {
        $group: {
          _id: "$_id.period",
          redeemed: {
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "present"] },
                  { $eq: ["$attendance", "redeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
          },
          unredeemed: {
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "absent"] },
                  { $eq: ["$attendance", "unredeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
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
      { $match: periodMatch },
      ...filteredRedemptionsAggregation,
      {
        $group: {
          _id: "$beneficiary._id",
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
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "present"] },
                  { $eq: ["$attendance", "redeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
          },
          unredeemed: {
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "absent"] },
                  { $eq: ["$attendance", "unredeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
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
      { $match: periodMatch },
      ...filteredRedemptionsAggregation,
      {
        $group: {
          _id: "$beneficiary._id",
          attendance: { $first: "$attendance" },
          province: { $first: "$beneficiary.province" }
        }
      },
      {
        $group: {
          _id: { $toUpper: { $trim: { input: "$province" } } },
          redeemed: {
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "present"] },
                  { $eq: ["$attendance", "redeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
          },
          unredeemed: {
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "absent"] },
                  { $eq: ["$attendance", "unredeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
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
    const { year, month, period, province, municipality } = req.query;

    let targetPeriod: string;
    if (period) {
      targetPeriod = period.toString();
    } else if (year && month) {
      targetPeriod = `${month} ${year}`;
    } else {
      targetPeriod = await getFrmPeriod();
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
      beneficiaryQuery.province = { $regex: new RegExp(`^\\s*${escapeRegex(province.toString().trim())}\\s*$`, "i") };
    }
    if (municipality) {
      beneficiaryQuery.municipality = { $regex: new RegExp(`^\\s*${escapeRegex(municipality.toString().trim())}\\s*$`, "i") };
    }

    // Filter NES records by area using a join with Beneficiary collection
    const filteredNESAggregation = [
      {
        $addFields: {
          beneficiary_id_obj: {
            $cond: {
              if: { $eq: [{ $type: "$beneficiary_id" }, "objectId"] },
              then: "$beneficiary_id",
              else: {
                $cond: {
                  if: { $and: [
                    { $ne: ["$beneficiary_id", ""] },
                    { $ne: ["$beneficiary_id", null] },
                    { $eq: [{ $type: "$beneficiary_id" }, "string"] },
                    { $eq: [{ $strLenCP: "$beneficiary_id" }, 24] }
                  ]},
                  then: { $toObjectId: "$beneficiary_id" },
                  else: null
                }
              }
            }
          },
          norm_beneficiary_id: { $toString: "$beneficiary_id" }
        }
      },
      {
        $lookup: {
          from: "beneficiaries",
          let: { b_id: "$beneficiary_id_obj", h_id: "$hhid", b_id_str: "$norm_beneficiary_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$_id", "$$b_id"] },
                    { $eq: [{ $toString: "$_id" }, "$$b_id_str"] },
                    { 
                      $and: [
                        { $ne: ["$$h_id", ""] },
                        { $ne: ["$$h_id", null] },
                        { $eq: ["$hhid", "$$h_id"] }
                      ]
                    }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: "beneficiary"
        }
      },
      { $unwind: "$beneficiary" },
      { $match: prefixQueryKeys(beneficiaryQuery, "beneficiary") }
    ];

    const totalNESResult = await NES.aggregate([
      ...filteredNESAggregation,
      {
        $group: {
          _id: { beneficiary_id: "$beneficiary._id", period: "$frm_period" }
        }
      },
      { $count: "total" }
    ]);
    const totalNES = totalNESResult[0]?.total || 0;
    const totalBeneficiaries = await Beneficiary.countDocuments(beneficiaryQuery);
    
    // Escape regex special characters in the period name (like parentheses)
    const escapedPeriod = escapeRegex(targetPeriod.trim());
    const periodMatch = { 
      frm_period: { $regex: new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i") } 
    };

    // Get stats by attendance (Filtered for target period)
    const attendanceStats = await NES.aggregate([
      { $match: periodMatch },
      ...filteredNESAggregation,
      {
        $group: {
          _id: "$beneficiary._id",
          attendance: { $first: "$attendance" }
        }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $in: ["$attendance", ["present", "redeemed"]] },
              "present",
              {
                $cond: [
                  { $in: ["$attendance", ["absent", "unredeemed"]] },
                  "absent",
                  "none"
                ]
              }
            ]
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get stats by top reasons for non-attendance (Filtered for target period)
    const reasonStats = await NES.aggregate([
      { 
        $match: { 
          ...periodMatch, 
          attendance: { $in: ["absent", "unredeemed"] }, 
          reason: { $ne: "" } 
        } 
      },
      ...filteredNESAggregation,
      {
        $group: {
          _id: "$beneficiary._id",
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
          _id: { beneficiary_id: "$beneficiary._id", period: "$frm_period" },
          attendance: { $first: "$attendance" }
        }
      },
      {
        $group: {
          _id: "$_id.period",
          attended: {
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "present"] },
                  { $eq: ["$attendance", "redeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
          },
          absent: {
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "absent"] },
                  { $eq: ["$attendance", "unredeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
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
      { $match: periodMatch },
      ...filteredNESAggregation,
      {
        $group: {
          _id: "$beneficiary._id",
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
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "present"] },
                  { $eq: ["$attendance", "redeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
          },
          absent: {
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "absent"] },
                  { $eq: ["$attendance", "unredeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
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
      { $match: periodMatch },
      ...filteredNESAggregation,
      {
        $group: {
          _id: "$beneficiary._id",
          attendance: { $first: "$attendance" },
          province: { $first: "$beneficiary.province" }
        }
      },
      {
        $group: {
          _id: { $toUpper: { $trim: { input: "$province" } } },
          attended: {
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "present"] },
                  { $eq: ["$attendance", "redeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
          },
          absent: {
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ["$attendance", "absent"] },
                  { $eq: ["$attendance", "unredeemed"] }
                ]}, 
                1, 
                0
              ] 
            }
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

