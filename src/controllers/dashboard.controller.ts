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

const normalizeArea = (str: string | undefined | null): string => {
  if (!str) return "Unknown";
  return str
    .trim()
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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
    const totalBeneficiaries = beneficiaries.length;
    
    if (totalBeneficiaries === 0) {
      return res.status(200).json({
        total_beneficiaries: 0,
        total_redemptions: 0,
        total_nes: 0,
        current_month: await getFrmPeriod(),
        month_redemptions: 0,
        month_nes: 0,
        redemption_attendance_rate: 0,
        nes_attendance_rate: 0,
        monthly_trends: []
      });
    }

    const beneficiaryIdList = beneficiaries.map(b => b._id.toString());
    const beneficiaryIdObjs = beneficiaries.map(b => b._id);
    const hhidList = beneficiaries.map(b => b.hhid).filter(h => !!h && h !== "0" && h !== "");

    const initialMatch = {
      $or: [
        { beneficiary_id: { $in: beneficiaryIdList } },
        { beneficiary_id: { $in: beneficiaryIdObjs } },
        { hhid: { $in: hhidList } }
      ]
    };

    // Helper to get total unique count (ben_id + period)
    const getOverallStats = async (model: any) => {
      const result = await model.aggregate([
        { $match: initialMatch },
        {
          $group: {
            _id: { 
              ben_id: { $ifNull: ["$beneficiary_id", "$hhid"] }, 
              period: "$frm_period" 
            }
          }
        },
        { $count: "total" }
      ]);
      return result[0]?.total || 0;
    };

    const [
      totalRedemptions,
      totalNES,
      currentPeriod
    ] = await Promise.all([
      getOverallStats(Redemption),
      getOverallStats(NES),
      getFrmPeriod()
    ]);

    // Get current FRM period stats
    const escapedCurrentPeriod = escapeRegex(currentPeriod.trim());
    const currentPeriodMatch = { 
      frm_period: { $regex: new RegExp(`^\\s*${escapedCurrentPeriod}\\s*$`, "i") } 
    };

    const [
      monthRedemptionStats,
      monthNESStats
    ] = await Promise.all([
      Redemption.aggregate([
        { $match: { ...initialMatch, ...currentPeriodMatch } },
        {
          $group: {
            _id: { $ifNull: ["$beneficiary_id", "$hhid"] },
            attendance: { $first: "$attendance" }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            present: {
              $sum: {
                $cond: [{ $in: [{ $toLower: "$attendance" }, ["present", "redeemed"]] }, 1, 0]
              }
            }
          }
        }
      ]),
      NES.aggregate([
        { $match: { ...initialMatch, ...currentPeriodMatch } },
        {
          $group: {
            _id: { $ifNull: ["$beneficiary_id", "$hhid"] },
            attendance: { $first: "$attendance" }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            present: {
              $sum: {
                $cond: [{ $in: [{ $toLower: "$attendance" }, ["present", "redeemed"]] }, 1, 0]
              }
            }
          }
        }
      ])
    ]);

    const monthRedemptions = monthRedemptionStats[0]?.total || 0;
    const presentRedemptions = monthRedemptionStats[0]?.present || 0;
    const monthNES = monthNESStats[0]?.total || 0;
    const presentNES = monthNESStats[0]?.present || 0;

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
      Redemption.distinct("frm_period", initialMatch),
      NES.distinct("frm_period", initialMatch)
    ]);

    const allPeriodsSet = new Set<string>([...redemptionPeriods, ...nesPeriods]);
    
    // Add custom schedules to the set
    try {
      const config = await SystemConfig.findOne({ key: "frm_schedules" });
      if (config && Array.isArray(config.value)) {
        config.value.forEach((s: any) => allPeriodsSet.add(s.name));
      }
    } catch (error) {
      console.error("Error fetching FRM schedules for dashboard trends:", error);
    }

    const allPeriods = Array.from(allPeriodsSet).filter(p => !!p);
    const sortedPeriods = allPeriods.sort((a, b) => b.localeCompare(a)).slice(0, 12);

    // Get trend stats for all relevant periods in one go for each model
    const [redemptionTrends, nesTrends] = await Promise.all([
      Redemption.aggregate([
        { $match: { ...initialMatch, frm_period: { $in: sortedPeriods } } },
        {
          $group: {
            _id: { ben_id: { $ifNull: ["$beneficiary_id", "$hhid"] }, period: "$frm_period" }
          }
        },
        {
          $group: {
            _id: "$_id.period",
            count: { $sum: 1 }
          }
        }
      ]),
      NES.aggregate([
        { $match: { ...initialMatch, frm_period: { $in: sortedPeriods } } },
        {
          $group: {
            _id: { ben_id: { $ifNull: ["$beneficiary_id", "$hhid"] }, period: "$frm_period" }
          }
        },
        {
          $group: {
            _id: "$_id.period",
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const redMap = new Map(redemptionTrends.map(t => [t._id, t.count]));
    const nesMap = new Map(nesTrends.map(t => [t._id, t.count]));

    stats.monthly_trends = sortedPeriods.map(periodStr => ({
      month: periodStr,
      fullName: periodStr,
      redemptions: redMap.get(periodStr) || 0,
      nes: nesMap.get(periodStr) || 0
    })).reverse();

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

    // 1. Fetch relevant beneficiaries once (This is the source of truth for the dashboard)
    const beneficiaries = await Beneficiary.find(beneficiaryQuery).select("_id hhid province municipality").lean();
    const totalBeneficiaries = beneficiaries.length;
    
    if (totalBeneficiaries === 0) {
      return res.status(200).json({
        totalRedemptions: 0,
        attendanceStats: [],
        periodStats: [],
        municipalityBreakdown: [],
        provinceBreakdown: []
      });
    }

    const beneficiaryIdList = beneficiaries.map(b => b._id.toString());
    const beneficiaryIdObjs = beneficiaries.map(b => b._id);
    const hhidList = beneficiaries.map(b => b.hhid).filter(h => !!h && h !== "0" && h !== "");

    // Create maps for quick lookup
    const benMapById = new Map();
    const benMapByHhid = new Map();
    beneficiaries.forEach(b => {
      benMapById.set(b._id.toString(), b);
      if (b.hhid && b.hhid !== "0") {
        benMapByHhid.set(b.hhid, b);
      }
    });

    const initialMatch = {
      $or: [
        { beneficiary_id: { $in: beneficiaryIdList } },
        { beneficiary_id: { $in: beneficiaryIdObjs } },
        { hhid: { $in: hhidList } }
      ]
    };

    // Helper to get normalized beneficiary ID from a redemption record
    const getBenId = (r: any) => {
      if (r.beneficiary_id) {
        const idStr = r.beneficiary_id.toString();
        if (benMapById.has(idStr)) return idStr;
      }
      if (r.hhid && r.hhid !== "0" && benMapByHhid.has(r.hhid)) {
        return benMapByHhid.get(r.hhid)._id.toString();
      }
      return null;
    };

    // 2. Get Total Redemptions (ever, for these beneficiaries)
    const totalRedemptionsResult = await Redemption.aggregate([
      { $match: initialMatch },
      {
        $group: {
          _id: { 
            ben_id: { $ifNull: ["$beneficiary_id", "$hhid"] }, 
            period: "$frm_period" 
          }
        }
      },
      { $count: "total" }
    ]);
    const totalRedemptions = totalRedemptionsResult[0]?.total || 0;

    // 3. Get Stats for Target Period
    const escapedPeriod = escapeRegex(targetPeriod.trim());
    const periodMatch = { 
      frm_period: { $regex: new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i") } 
    };

    const targetPeriodRedemptions = await Redemption.find({
      ...initialMatch,
      ...periodMatch
    }).lean();

    // Process target period redemptions in memory for attendance and breakdowns
    const attendanceCounts: any = { present: 0, absent: 0, none: 0 };
    const muniStats = new Map<string, { redeemed: number, unredeemed: number }>();
    const provStats = new Map<string, { redeemed: number, unredeemed: number }>();
    
    // Track unique beneficiaries processed for the target period
    const processedBenIds = new Set<string>();

    targetPeriodRedemptions.forEach(r => {
      const bId = getBenId(r);
      if (!bId || processedBenIds.has(bId)) return;
      processedBenIds.add(bId);

      const ben = benMapById.get(bId);
      const att = (r.attendance || "").toLowerCase();
      const isPresent = ["present", "redeemed"].includes(att);
      const isAbsent = ["absent", "unredeemed"].includes(att);

      if (isPresent) attendanceCounts.present++;
      else if (isAbsent) attendanceCounts.absent++;
      else attendanceCounts.none++;

      // Municipality breakdown
      const province = normalizeArea(ben?.province);
      const municipality = normalizeArea(ben?.municipality);
      const mKey = `${province}|${municipality}`;
      if (!muniStats.has(mKey)) muniStats.set(mKey, { redeemed: 0, unredeemed: 0 });
      const mS = muniStats.get(mKey)!;
      if (isPresent) mS.redeemed++;
      if (isAbsent) mS.unredeemed++;

      // Province breakdown
      const pKey = province;
      if (!provStats.has(pKey)) provStats.set(pKey, { redeemed: 0, unredeemed: 0 });
      const pS = provStats.get(pKey)!;
      if (isPresent) pS.redeemed++;
      if (isAbsent) pS.unredeemed++;
    });

    const attendanceStats = [
      { _id: "present", count: attendanceCounts.present },
      { _id: "absent", count: attendanceCounts.absent },
      { _id: "none", count: attendanceCounts.none }
    ];

    // 4. Get Trend Stats (last 12 periods)
    const trendStatsRaw = await Redemption.aggregate([
      { $match: initialMatch },
      {
        $group: {
          _id: { 
            ben_id: { $ifNull: ["$beneficiary_id", "$hhid"] }, 
            period: "$frm_period" 
          },
          attendance: { $first: "$attendance" }
        }
      },
      {
        $group: {
          _id: "$_id.period",
          redeemed: {
            $sum: { 
              $cond: [
                { $in: [{ $toLower: "$attendance" }, ["present", "redeemed"]] },
                1, 
                0
              ] 
            }
          },
          unredeemed: {
            $sum: { 
              $cond: [
                { $in: [{ $toLower: "$attendance" }, ["absent", "unredeemed"]] },
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

    const periodStats = trendStatsRaw.map(p => {
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

    // 5. Build Final Breakdowns
    // Municipality breakdown (Targets from in-memory beneficiaries)
    const muniTargets = new Map<string, number>();
    beneficiaries.forEach(b => {
      const province = normalizeArea(b.province);
      const municipality = normalizeArea(b.municipality);
      const key = `${province}|${municipality}`;
      muniTargets.set(key, (muniTargets.get(key) || 0) + 1);
    });

    const municipalityBreakdown = Array.from(muniTargets.entries()).map(([key, target]) => {
      const [province, municipality] = key.split("|");
      const rec = muniStats.get(key) || { redeemed: 0, unredeemed: 0 };
      const remaining = target - rec.redeemed - rec.unredeemed;
      return {
        municipality,
        province,
        target,
        redeemed: rec.redeemed,
        unredeemed: rec.unredeemed,
        remaining: remaining > 0 ? remaining : 0
      };
    }).sort((a, b) => a.municipality.localeCompare(b.municipality));

    // Province breakdown
    const provTargets = new Map<string, number>();
    beneficiaries.forEach(b => {
      const key = normalizeArea(b.province);
      provTargets.set(key, (provTargets.get(key) || 0) + 1);
    });

    const provinceBreakdown = Array.from(provTargets.entries()).map(([province, target]) => {
      const rec = provStats.get(province) || { redeemed: 0, unredeemed: 0 };
      const remaining = target - rec.redeemed - rec.unredeemed;
      return {
        province,
        target,
        redeemed: rec.redeemed,
        unredeemed: rec.unredeemed,
        remaining: remaining > 0 ? remaining : 0
      };
    }).sort((a, b) => a.province.localeCompare(b.province));

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

    // 1. Fetch relevant beneficiaries once (This is the source of truth for the dashboard)
    const beneficiaries = await Beneficiary.find(beneficiaryQuery).select("_id hhid province municipality").lean();
    const totalBeneficiaries = beneficiaries.length;
    
    if (totalBeneficiaries === 0) {
      return res.status(200).json({
        totalNES: 0,
        attendanceStats: [],
        periodStats: [],
        municipalityBreakdown: [],
        provinceBreakdown: []
      });
    }

    const beneficiaryIdList = beneficiaries.map(b => b._id.toString());
    const beneficiaryIdObjs = beneficiaries.map(b => b._id);
    const hhidList = beneficiaries.map(b => b.hhid).filter(h => !!h && h !== "0" && h !== "");

    // Create maps for quick lookup
    const benMapById = new Map();
    const benMapByHhid = new Map();
    beneficiaries.forEach(b => {
      benMapById.set(b._id.toString(), b);
      if (b.hhid && b.hhid !== "0") {
        benMapByHhid.set(b.hhid, b);
      }
    });

    const initialMatch = {
      $or: [
        { beneficiary_id: { $in: beneficiaryIdList } },
        { beneficiary_id: { $in: beneficiaryIdObjs } },
        { hhid: { $in: hhidList } }
      ]
    };

    // Helper to get normalized beneficiary ID from a NES record
    const getBenId = (r: any) => {
      if (r.beneficiary_id) {
        const idStr = r.beneficiary_id.toString();
        if (benMapById.has(idStr)) return idStr;
      }
      if (r.hhid && r.hhid !== "0" && benMapByHhid.has(r.hhid)) {
        return benMapByHhid.get(r.hhid)._id.toString();
      }
      return null;
    };

    // 2. Get Total NES (ever, for these beneficiaries)
    const totalNESResult = await NES.aggregate([
      { $match: initialMatch },
      {
        $group: {
          _id: { 
            ben_id: { $ifNull: ["$beneficiary_id", "$hhid"] }, 
            period: "$frm_period" 
          }
        }
      },
      { $count: "total" }
    ]);
    const totalNES = totalNESResult[0]?.total || 0;

    // 3. Get Stats for Target Period
    const escapedPeriod = escapeRegex(targetPeriod.trim());
    const periodMatch = { 
      frm_period: { $regex: new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i") } 
    };

    const targetPeriodNES = await NES.find({
      ...initialMatch,
      ...periodMatch
    }).lean();

    // Process target period NES records in memory for attendance and breakdowns
    const attendanceCounts: any = { present: 0, absent: 0, none: 0 };
    const muniStats = new Map<string, { attended: number, unattended: number }>();
    const provStats = new Map<string, { attended: number, unattended: number }>();
    
    // Track unique beneficiaries processed for the target period
    const processedBenIds = new Set<string>();

    targetPeriodNES.forEach(r => {
      const bId = getBenId(r);
      if (!bId || processedBenIds.has(bId)) return;
      processedBenIds.add(bId);

      const ben = benMapById.get(bId);
      const att = (r.attendance || "").toLowerCase();
      const isPresent = ["present", "redeemed"].includes(att);
      const isAbsent = ["absent", "unredeemed"].includes(att);

      if (isPresent) attendanceCounts.present++;
      else if (isAbsent) attendanceCounts.absent++;
      else attendanceCounts.none++;

      // Municipality breakdown
      const province = normalizeArea(ben?.province);
      const municipality = normalizeArea(ben?.municipality);
      const mKey = `${province}|${municipality}`;
      if (!muniStats.has(mKey)) muniStats.set(mKey, { attended: 0, unattended: 0 });
      const mS = muniStats.get(mKey)!;
      if (isPresent) mS.attended++;
      if (isAbsent) mS.unattended++;

      // Province breakdown
      const pKey = province;
      if (!provStats.has(pKey)) provStats.set(pKey, { attended: 0, unattended: 0 });
      const pS = provStats.get(pKey)!;
      if (isPresent) pS.attended++;
      if (isAbsent) pS.unattended++;
    });

    const attendanceStats = [
      { _id: "present", count: attendanceCounts.present },
      { _id: "absent", count: attendanceCounts.absent },
      { _id: "none", count: attendanceCounts.none }
    ];

    // 4. Get Trend Stats (last 12 periods)
    const trendStatsRaw = await NES.aggregate([
      { $match: initialMatch },
      {
        $group: {
          _id: { 
            ben_id: { $ifNull: ["$beneficiary_id", "$hhid"] }, 
            period: "$frm_period" 
          },
          attendance: { $first: "$attendance" }
        }
      },
      {
        $group: {
          _id: "$_id.period",
          attended: {
            $sum: { 
              $cond: [
                { $in: [{ $toLower: "$attendance" }, ["present", "redeemed"]] },
                1, 
                0
              ] 
            }
          },
          unattended: {
            $sum: { 
              $cond: [
                { $in: [{ $toLower: "$attendance" }, ["absent", "unredeemed"]] },
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

    const periodStats = trendStatsRaw.map(p => {
      const attended = p.attended || 0;
      const unattended = p.unattended || 0;
      const remaining = totalBeneficiaries - attended - unattended;
      return {
        period: p._id,
        attended,
        unattended,
        remaining: remaining > 0 ? remaining : 0,
        target: totalBeneficiaries
      };
    });

    // 5. Build Final Breakdowns
    // Municipality breakdown (Targets from in-memory beneficiaries)
    const muniTargets = new Map<string, number>();
    beneficiaries.forEach(b => {
      const province = normalizeArea(b.province);
      const municipality = normalizeArea(b.municipality);
      const key = `${province}|${municipality}`;
      muniTargets.set(key, (muniTargets.get(key) || 0) + 1);
    });

    const municipalityBreakdown = Array.from(muniTargets.entries()).map(([key, target]) => {
      const [province, municipality] = key.split("|");
      const rec = muniStats.get(key) || { attended: 0, unattended: 0 };
      const remaining = target - rec.attended - rec.unattended;
      return {
        municipality,
        province,
        target,
        attended: rec.attended,
        unattended: rec.unattended,
        remaining: remaining > 0 ? remaining : 0
      };
    }).sort((a, b) => a.municipality.localeCompare(b.municipality));

    // Province breakdown
    const provTargets = new Map<string, number>();
    beneficiaries.forEach(b => {
      const key = normalizeArea(b.province);
      provTargets.set(key, (provTargets.get(key) || 0) + 1);
    });

    const provinceBreakdown = Array.from(provTargets.entries()).map(([province, target]) => {
      const rec = provStats.get(province) || { attended: 0, unattended: 0 };
      const remaining = target - rec.attended - rec.unattended;
      return {
        province,
        target,
        attended: rec.attended,
        unattended: rec.unattended,
        remaining: remaining > 0 ? remaining : 0
      };
    }).sort((a, b) => a.province.localeCompare(b.province));

    res.status(200).json({
      totalNES,
      attendanceStats,
      periodStats,
      municipalityBreakdown,
      provinceBreakdown
    });
  }
);

