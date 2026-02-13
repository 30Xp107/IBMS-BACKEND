import { Request, Response } from "express";
import { Beneficiary } from "../models/beneficiary.model";
import { Redemption } from "../models/redemption.model";
import { NES } from "../models/nes.model";
import userModel from "../models/user.model";
import { SystemConfig } from "../models/systemConfig.model";
import { catchAsync } from "../utils/catchAsync";
import { getAreaFilter } from "../utils/areaFilter";
import { getFrmPeriod } from "../utils/frmHelpers";
import { normalizeArea } from "../utils/normalization";

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
    let beneficiaryQuery: any = {};
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

    // Optimization: Create lookup maps for faster matching
    const benIdMap = new Set(beneficiaryIdList);
    const hhidMap = new Map();
    beneficiaries.forEach(b => {
      if (b.hhid && b.hhid !== "0") {
        if (!hhidMap.has(b.hhid)) hhidMap.set(b.hhid, []);
        hhidMap.get(b.hhid).push(b._id.toString());
      }
    });

    const initialMatch = {
      $or: [
        { beneficiary_id: { $in: beneficiaryIdList } },
        { beneficiary_id: { $in: beneficiaryIdObjs } },
        { hhid: { $in: hhidList } }
      ]
    };

    // Helper to get total unique count (beneficiaries * periods) for "present" redemptions
    const getOverallStats = async (model: any) => {
      const records = await model.find({ 
        ...initialMatch, 
        attendance: { $in: ["present", "redeemed", "Present", "Redeemed"] } 
      }).select("beneficiary_id hhid frm_period").lean();

      const uniqueServiced = new Set<string>();
      records.forEach((r: any) => {
        const period = r.frm_period;
        if (!period) return;

        const bId = r.beneficiary_id?.toString();
        const hhid = r.hhid;

        // Fast lookup using maps instead of nested forEach
        if (bId && benIdMap.has(bId)) {
          uniqueServiced.add(`${bId}|${period}`);
        }
        
        if (hhid && hhid !== "0" && hhidMap.has(hhid)) {
          const matchingBenIds = hhidMap.get(hhid);
          matchingBenIds.forEach((id: string) => {
            uniqueServiced.add(`${id}|${period}`);
          });
        }
      });
      return uniqueServiced.size;
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

    const statusPriorityAgg = {
      $switch: {
        branches: [
          { case: { $in: [{ $toLower: "$attendance" }, ["present", "redeemed"]] }, then: 2 },
          { case: { $in: [{ $toLower: "$attendance" }, ["absent", "unredeemed"]] }, then: 1 }
        ],
        default: 0
      }
    };

    const [
      targetPeriodRedemptions,
      targetPeriodNES
    ] = await Promise.all([
      Redemption.find({ ...initialMatch, ...currentPeriodMatch }).select("beneficiary_id hhid attendance").lean(),
      NES.find({ ...initialMatch, ...currentPeriodMatch }).select("beneficiary_id hhid attendance").lean()
    ]);

    // Process target period records to collect IDs and HHIDs by status
    const presentBenIds = new Set<string>();
    const presentHhids = new Set<string>();
    const absentBenIds = new Set<string>();
    const absentHhids = new Set<string>();

    [...targetPeriodRedemptions, ...targetPeriodNES].forEach(r => {
      const att = (r.attendance || "").toLowerCase();
      if (["present", "redeemed"].includes(att)) {
        if (r.beneficiary_id) presentBenIds.add(r.beneficiary_id.toString());
        if (r.hhid && r.hhid !== "0" && r.hhid !== "") presentHhids.add(r.hhid);
      } else if (["absent", "unredeemed"].includes(att)) {
        if (r.beneficiary_id) absentBenIds.add(r.beneficiary_id.toString());
        if (r.hhid && r.hhid !== "0" && r.hhid !== "") absentHhids.add(r.hhid);
      }
    });

    let monthRedemptions = 0;
    let presentRedemptions = 0;
    let monthNES = 0;
    let presentNES = 0;

    // Separate counts for Redemption and NES based on records found
    // We need to count how many beneficiaries match Redemption records and how many match NES records
    const redPresIds = new Set<string>();
    const redPresHhids = new Set<string>();
    const redAbsIds = new Set<string>();
    const redAbsHhids = new Set<string>();

    targetPeriodRedemptions.forEach(r => {
      const att = (r.attendance || "").toLowerCase();
      if (["present", "redeemed"].includes(att)) {
        if (r.beneficiary_id) redPresIds.add(r.beneficiary_id.toString());
        if (r.hhid && r.hhid !== "0") redPresHhids.add(r.hhid);
      } else if (["absent", "unredeemed"].includes(att)) {
        if (r.beneficiary_id) redAbsIds.add(r.beneficiary_id.toString());
        if (r.hhid && r.hhid !== "0") redAbsHhids.add(r.hhid);
      }
    });

    const nesPresIds = new Set<string>();
    const nesPresHhids = new Set<string>();
    const nesAbsIds = new Set<string>();
    const nesAbsHhids = new Set<string>();

    targetPeriodNES.forEach(r => {
      const att = (r.attendance || "").toLowerCase();
      if (["present", "redeemed"].includes(att)) {
        if (r.beneficiary_id) nesPresIds.add(r.beneficiary_id.toString());
        if (r.hhid && r.hhid !== "0") nesPresHhids.add(r.hhid);
      } else if (["absent", "unredeemed"].includes(att)) {
        if (r.beneficiary_id) nesAbsIds.add(r.beneficiary_id.toString());
        if (r.hhid && r.hhid !== "0") nesAbsHhids.add(r.hhid);
      }
    });

    beneficiaries.forEach(ben => {
      const bId = ben._id.toString();
      const hhid = ben.hhid;

      const isRedPres = redPresIds.has(bId) || (hhid && hhid !== "0" && hhid !== "" && redPresHhids.has(hhid));
      const isRedAbs = redAbsIds.has(bId) || (hhid && hhid !== "0" && hhid !== "" && redAbsHhids.has(hhid));
      const isNesPres = nesPresIds.has(bId) || (hhid && hhid !== "0" && hhid !== "" && nesPresHhids.has(hhid));
      const isNesAbs = nesAbsIds.has(bId) || (hhid && hhid !== "0" && hhid !== "" && nesAbsHhids.has(hhid));

      // Redemption counts (non-exclusive matches tracking page filters)
      if (isRedPres) {
        monthRedemptions++;
        presentRedemptions++;
      }
      if (isRedAbs) {
        // If not already counted as present, increment total to include absent-only beneficiaries
        if (!isRedPres) monthRedemptions++;
      }

      // NES counts (non-exclusive matches tracking page filters)
      if (isNesPres) {
        monthNES++;
        presentNES++;
      }
      if (isNesAbs) {
        // If not already counted as present, increment total to include absent-only beneficiaries
        if (!isNesPres) monthNES++;
      }
    });

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
    const [redemptionTrendRaw, nesTrendRaw] = await Promise.all([
      Redemption.find({ 
        ...initialMatch, 
        frm_period: { $in: sortedPeriods },
        attendance: { $in: ["present", "redeemed", "Present", "Redeemed"] }
      }).select("beneficiary_id hhid frm_period").lean(),
      NES.find({ 
        ...initialMatch, 
        frm_period: { $in: sortedPeriods },
        attendance: { $in: ["present", "redeemed", "Present", "Redeemed"] }
      }).select("beneficiary_id hhid frm_period").lean()
    ]);

    const periodPresentIds = new Map<string, Set<string>>(); 
    const periodPresentHhids = new Map<string, Set<string>>();

    [...redemptionTrendRaw, ...nesTrendRaw].forEach(r => {
      const period = r.frm_period;
      if (!period) return;
      if (!periodPresentIds.has(period)) periodPresentIds.set(period, new Set());
      if (!periodPresentHhids.has(period)) periodPresentHhids.set(period, new Set());
      if (r.beneficiary_id) periodPresentIds.get(period)!.add(r.beneficiary_id.toString());
      if (r.hhid && r.hhid !== "0") periodPresentHhids.get(period)!.add(r.hhid);
    });

    const monthlyTrends = sortedPeriods.map(period => {
      const presIds = periodPresentIds.get(period) || new Set();
      const presHhids = periodPresentHhids.get(period) || new Set();
      
      let count = 0;
      beneficiaries.forEach(ben => {
        if (presIds.has(ben._id.toString()) || (ben.hhid && ben.hhid !== "0" && presHhids.has(ben.hhid))) {
          count++;
        }
      });

      return {
        period,
        count
      };
    }).reverse();

    stats.monthly_trends = monthlyTrends;

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

    let beneficiaryQuery: any = {};
    
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

    // Optimization: Pre-calculate maps for O(1) lookup
    const benIdMap = new Set(beneficiaryIdList);
    const hhidMap = new Map<string, string[]>();
    beneficiaries.forEach(b => {
      if (b.hhid && b.hhid !== "0") {
        if (!hhidMap.has(b.hhid)) hhidMap.set(b.hhid, []);
        hhidMap.get(b.hhid)!.push(b._id.toString());
      }
    });

    const initialMatch = {
      $or: [
        { beneficiary_id: { $in: beneficiaryIdList } },
        { beneficiary_id: { $in: beneficiaryIdObjs } },
        { hhid: { $in: hhidList } }
      ]
    };

    // 2. Get Total Redemptions (ever, for these beneficiaries)
    // Only count "present" or "redeemed" status
    const presentStatusMatch = { 
      attendance: { $in: ["present", "redeemed", "Present", "Redeemed"] } 
    };

    const [totalRedemptionsRaw, totalNESRaw] = await Promise.all([
      Redemption.aggregate([
        { $match: { ...initialMatch, ...presentStatusMatch } },
        {
          $project: {
            ben_id: { $ifNull: ["$beneficiary_id", "$hhid"] },
            period: "$frm_period"
          }
        }
      ]),
      NES.aggregate([
        { $match: { ...initialMatch, ...presentStatusMatch } },
        {
          $project: {
            ben_id: { $ifNull: ["$beneficiary_id", "$hhid"] },
            period: "$frm_period"
          }
        }
      ])
    ]);

    // To match Redemption Page filtering, we need to count how many beneficiaries match these records
    // However, "Total Redemptions" is typically a count of service events.
    // Given the user's discrepancy is about the period-specific "redeemed" count, 
    // let's ensure the period stats and trend stats are consistent with the page filters.
    
    const uniqueRedemptionsSet = new Set<string>();
    [...totalRedemptionsRaw, ...totalNESRaw].forEach(r => {
      const bIdOrHhid = r.ben_id?.toString();
      if (!bIdOrHhid || !r.period) return;

      // Check if it's a direct beneficiary ID match
      if (benIdMap.has(bIdOrHhid)) {
        uniqueRedemptionsSet.add(`${bIdOrHhid}|${r.period}`);
      } else if (hhidMap.has(bIdOrHhid)) {
        // If it's an HHID match, add all beneficiaries in that HH
        hhidMap.get(bIdOrHhid)!.forEach(id => {
          uniqueRedemptionsSet.add(`${id}|${r.period}`);
        });
      }
    });
    const totalRedemptions = uniqueRedemptionsSet.size;

    // 3. Get Stats for Target Period - Including both FRM and NES
    const escapedPeriod = escapeRegex(targetPeriod.trim());
    const periodMatch = { 
      frm_period: { $regex: new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i") } 
    };

    // DEBUG: Log record counts to trace discrepancy
    const [targetPeriodRedemptions, targetPeriodNES] = await Promise.all([
      Redemption.find({
        ...initialMatch,
        ...periodMatch
      }).lean(),
      NES.find({
        ...initialMatch,
        ...periodMatch
      }).lean()
    ]);
    
    console.log(`[DASHBOARD DEBUG] Target Period: "${targetPeriod}"`);
    console.log(`[DASHBOARD DEBUG] Found ${targetPeriodRedemptions.length} Redemptions and ${targetPeriodNES.length} NES records`);

    // Process target period records to collect IDs and HHIDs by status
    const presentBenIds = new Set<string>();
    const presentHhids = new Set<string>();
    const absentBenIds = new Set<string>();
    const absentHhids = new Set<string>();
    const hasRecordBenIds = new Set<string>();
    const hasRecordHhids = new Set<string>();

    [...targetPeriodRedemptions, ...targetPeriodNES].forEach(r => {
      const att = (r.attendance || "").toLowerCase();
      const isPresent = ["present", "redeemed"].includes(att);
      const isAbsent = ["absent", "unredeemed"].includes(att);

      if (r.beneficiary_id) hasRecordBenIds.add(r.beneficiary_id.toString());
      if (r.hhid && r.hhid !== "0" && r.hhid !== "") hasRecordHhids.add(r.hhid);

      if (isPresent) {
        if (r.beneficiary_id) presentBenIds.add(r.beneficiary_id.toString());
        if (r.hhid && r.hhid !== "0" && r.hhid !== "") presentHhids.add(r.hhid);
      } 
      if (isAbsent) {
        if (r.beneficiary_id) absentBenIds.add(r.beneficiary_id.toString());
        if (r.hhid && r.hhid !== "0" && r.hhid !== "") absentHhids.add(r.hhid);
      }
    });

    // Process target period records in memory for attendance and breakdowns
    const attendanceCounts: any = { present: 0, absent: 0, none: 0 };
    const muniStats = new Map<string, { redeemed: number, unredeemed: number }>();
    const provStats = new Map<string, { redeemed: number, unredeemed: number }>();
    
    // Process each beneficiary from the FULL list to match Redemption Page filtering logic
    beneficiaries.forEach(ben => {
      const bId = ben._id.toString();
      const hhid = ben.hhid;
      
      const isPresent = presentBenIds.has(bId) || (hhid && hhid !== "0" && hhid !== "" && presentHhids.has(hhid));
      const isAbsent = absentBenIds.has(bId) || (hhid && hhid !== "0" && hhid !== "" && absentHhids.has(hhid));
      const hasRecord = hasRecordBenIds.has(bId) || (hhid && hhid !== "0" && hhid !== "" && hasRecordHhids.has(hhid));

      if (isPresent) attendanceCounts.present++;
      if (isAbsent) attendanceCounts.absent++;
      if (!hasRecord) attendanceCounts.none++;

      // Municipality breakdown (matches Redemption Page "Redeemed" and "Unredeemed" counts)
      const province = normalizeArea(ben.province);
      const municipality = normalizeArea(ben.municipality);
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

    // 4. Get Trend Stats (last 12 periods) - Including both FRM and NES
    const statusPriority = {
      $switch: {
        branches: [
          { case: { $in: [{ $toLower: "$attendance" }, ["present", "redeemed"]] }, then: 2 },
          { case: { $in: [{ $toLower: "$attendance" }, ["absent", "unredeemed"]] }, then: 1 }
        ],
        default: 0
      }
    };

    const [redemptionTrendRaw, nesTrendRaw] = await Promise.all([
      Redemption.aggregate([
        { $match: initialMatch },
        {
          $project: {
            beneficiary_id: 1,
            hhid: 1,
            frm_period: 1,
            priority: statusPriority
          }
        }
      ]),
      NES.aggregate([
        { $match: initialMatch },
        {
          $project: {
            beneficiary_id: 1,
            hhid: 1,
            frm_period: 1,
            priority: statusPriority
          }
        }
      ])
    ]);

    // Map to store highest priority per (ID/HHID, period)
    const periodPresentIds = new Map<string, Set<string>>(); // period -> Set of ben_ids
    const periodPresentHhids = new Map<string, Set<string>>(); // period -> Set of hhids
    const periodAbsentIds = new Map<string, Set<string>>(); // period -> Set of ben_ids
    const periodAbsentHhids = new Map<string, Set<string>>(); // period -> Set of hhids

    [...redemptionTrendRaw, ...nesTrendRaw].forEach(p => {
      const period = p.frm_period;
      if (!period) return;

      if (p.priority === 2) {
        if (!periodPresentIds.has(period)) periodPresentIds.set(period, new Set());
        if (!periodPresentHhids.has(period)) periodPresentHhids.set(period, new Set());
        if (p.beneficiary_id) periodPresentIds.get(period)!.add(p.beneficiary_id.toString());
        if (p.hhid && p.hhid !== "0") periodPresentHhids.get(period)!.add(p.hhid);
      } else if (p.priority === 1) {
        if (!periodAbsentIds.has(period)) periodAbsentIds.set(period, new Set());
        if (!periodAbsentHhids.has(period)) periodAbsentHhids.set(period, new Set());
        if (p.beneficiary_id) periodAbsentIds.get(period)!.add(p.beneficiary_id.toString());
        if (p.hhid && p.hhid !== "0") periodAbsentHhids.get(period)!.add(p.hhid);
      }
    });

    const allTrendPeriods = Array.from(new Set([
      ...periodPresentIds.keys(), 
      ...periodAbsentIds.keys()
    ])).sort((a, b) => b.localeCompare(a)).slice(0, 12);

    const trendByPeriod = new Map<string, { redeemed: number, unredeemed: number }>();
    
    allTrendPeriods.forEach(period => {
      const presIds = periodPresentIds.get(period) || new Set();
      const presHhids = periodPresentHhids.get(period) || new Set();
      const absIds = periodAbsentIds.get(period) || new Set();
      const absHhids = periodAbsentHhids.get(period) || new Set();

      let redeemed = 0;
      let unredeemed = 0;

      // Use the pre-filtered beneficiaries list (source of truth)
      beneficiaries.forEach(ben => {
        const bId = ben._id.toString();
        const hhid = ben.hhid;
        
        const isPres = presIds.has(bId) || (hhid && hhid !== "0" && presHhids.has(hhid));
        const isAbs = absIds.has(bId) || (hhid && hhid !== "0" && absHhids.has(hhid));

        // FIX: Remove 'else if' to match municipalityBreakdown logic (fixes 336 vs 338 discrepancy)
        // If a beneficiary is both present and absent (e.g. across Redemption/NES), count both
        if (isPres) redeemed++;
        if (isAbs) unredeemed++;
      });

      trendByPeriod.set(period, { redeemed, unredeemed });
    });

    const trendStatsRaw = allTrendPeriods.map(period => ({
      _id: period,
      ...trendByPeriod.get(period)!
    }));

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

    let beneficiaryQuery: any = {};
    
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
        absent: unattended,
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
        absent: rec.unattended,
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
        absent: rec.unattended,
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

