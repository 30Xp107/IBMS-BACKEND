import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Beneficiary } from "../models/beneficiary.model";
import { Area } from "../models/area.model";
import ErrorHandler from "../utils/ErrorHandler";
import { catchAsync } from "../utils/catchAsync";
import { logAudit } from "../utils/auditLogger";
import { getAreaFilter } from "../utils/areaFilter";
import { normalizeArea } from "../utils/normalization";

/**
 * Standardizes area names in the request body based on the Area collection
 */
const standardizeAreaNames = async (body: any) => {
  const types = ['region', 'province', 'municipality', 'barangay'];
  
  for (const type of types) {
    const value = body[type];
    if (value && typeof value === 'string' && value.toLowerCase() !== 'all') {
      const val = value.trim();
      const escapedValue = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      let pattern = `^\\s*${escapedValue}\\s*$`;
      
      if (type === 'municipality') {
        const cityMatch = val.match(/^(city of\s+)?(.+?)(\s+city)?(\s*\(.+?\))?$/i);
        const muniMatch = val.match(/^(municipality of\s+)?(.+?)(\s+municipality)?(\s*\(.+?\))?$/i);
        
        const core = (cityMatch?.[2] || muniMatch?.[2] || val).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = `^\\s*((city of\\s+)?${core}(\\s+city)?|(municipality of\\s+)?${core}(\\s+municipality)?)(\\s*\\(.+?\\))?\\s*$`;
      }
      
      const areaRecord = await Area.findOne({
        type: type as any,
        name: { $regex: new RegExp(pattern, "i") }
      });
      
      if (areaRecord) {
        body[type] = areaRecord.name;
      } else {
        // Fallback to manual normalization if no area record found
        body[type] = normalizeArea(value);
      }
    }
  }
};

const escapeRegex = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

import { Redemption } from "../models/redemption.model";
import { NES } from "../models/nes.model";

const buildBeneficiaryQuery = async (req: Request, customFilters?: any) => {
  const user = (req as any).user;
  const { 
    barangay, 
    municipality, 
    province, 
    region, 
    status, 
    search, 
    redemption_status,
    frm_period,
    is4ps
  } = customFilters || req.query;

  const query: any = {};
  const filters: any[] = [];

  // Filter by is4ps
  if (is4ps && is4ps !== "all") {
    query.is4ps = { $regex: new RegExp(`^${is4ps}$`, "i") };
  }

  // Filter by user's assigned areas if not admin
  if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
    const areaFilter = await getAreaFilter(user.assigned_areas);
    if (areaFilter) {
      filters.push(areaFilter);
    }
  }

  // Filter by redemption status if provided
  if (redemption_status && redemption_status !== "all") {
    console.log(`Filtering by redemption_status: ${redemption_status}, frm_period: ${frm_period}`);
    const isRedeemed = redemption_status === "redeemed" || redemption_status === "present";
    const isAbsent = redemption_status === "unredeemed" || redemption_status === "absent";
    const isNone = redemption_status === "none";

    try {
      // Find the IDs/HHIDs of people who match the status
      const recordQuery: any = {};
      if (frm_period && frm_period !== "all") {
        const escapedPeriod = (frm_period as string).trim().replace(/[.*+?^${}()|[\\\]]/g, '\\$&');
        recordQuery.frm_period = { $regex: new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i") };
      }
      
      if (isRedeemed) {
        recordQuery.attendance = { $in: ["present", "redeemed", "Present", "Redeemed"] };
      } else if (isAbsent) {
        recordQuery.attendance = { $in: ["absent", "unredeemed", "Absent", "Unredeemed"] };
      }
      
      console.log('Record query:', JSON.stringify(recordQuery));

      const [redemptions, nesRecords] = await Promise.all([
        Redemption.find(recordQuery).select("beneficiary_id hhid").lean(),
        NES.find(recordQuery).select("beneficiary_id hhid").lean()
      ]);

      console.log(`Found ${redemptions.length} redemptions and ${nesRecords.length} NES records`);

      const matchedBenIds = new Set<string>();
      const matchedHhids = new Set<string>();

      [...redemptions, ...nesRecords].forEach(r => {
        if (r.beneficiary_id) matchedBenIds.add(r.beneficiary_id.toString());
        if (r.hhid && r.hhid !== "0" && r.hhid !== "") matchedHhids.add(r.hhid);
      });

      const benIdObjs = Array.from(matchedBenIds).filter(id => id.length === 24).map(id => new mongoose.Types.ObjectId(id));
      const hhidList = Array.from(matchedHhids).filter(h => !!h);

      console.log(`Matched ${benIdObjs.length} beneficiary IDs and ${hhidList.length} HHIDs`);

      if (isRedeemed || isAbsent) {
        // Show people who ARE in the matched set
        filters.push({
          $or: [
            { _id: { $in: benIdObjs } },
            { hhid: { $in: hhidList } }
          ]
        });
      } else if (isNone) {
        // Show people who ARE NOT in the matched set (anyone with NO record)
        filters.push({
          $and: [
            { _id: { $nin: benIdObjs } },
            { hhid: { $nin: hhidList } }
          ]
        });
      }
    } catch (error) {
      console.error("Error in redemption status filter:", error);
    }
  }

  // Add other filters
  if (barangay && barangay !== "all") {
    const val = (barangay as string).trim();
    const escapedValue = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Use partial match instead of strict start/end match to handle "Barangay 9 (Pob.)" vs "Barangay 9"
    query.barangay = { $regex: new RegExp(escapedValue, "i") };
  }
  if (municipality && municipality !== "all") {
    const val = (municipality as string).trim();
    const cityMatch = val.match(/^(city of\s+)?(.+?)(\s+city)?(\s*\(.+?\))?$/i);
    const muniMatch = val.match(/^(municipality of\s+)?(.+?)(\s+municipality)?(\s*\(.+?\))?$/i);
    const core = (cityMatch?.[2] || muniMatch?.[2] || val).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = `^\\s*((city of\\s+)?${core}(\\s+city)?|(municipality of\\s+)?${core}(\\s+municipality)?)(\\s*\\(.+?\\))?\\s*$`;
    query.municipality = { $regex: new RegExp(pattern, "i") };
  }
  if (province && province !== "all") {
    const val = (province as string).trim();
    const escapedValue = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.province = { $regex: new RegExp(`^\\s*${escapedValue}\\s*$`, "i") };
  }
  if (region && region !== "all") {
    const val = (region as string).trim();
    const escapedValue = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.region = { $regex: new RegExp(`^\\s*${escapedValue}\\s*$`, "i") };
  }
  if (status && status !== "all") {
    query.status = status;
  }

  if (search) {
    const searchRegex = { $regex: search as string, $options: "i" };
    filters.push({
      $or: [
        { hhid: searchRegex },
        { first_name: searchRegex },
        { last_name: searchRegex },
        { pkno: searchRegex },
      ]
    });
  }

  if (filters.length > 0) {
    query.$and = filters;
  }

  return query;
};

export const getBeneficiaries = catchAsync(
  async (req: Request, res: Response) => {
    const { 
      page = 1, 
      limit = 10, 
      sort = "createdAt", 
      order = "desc",
      frm_period
    } = req.query;

    const query = await buildBeneficiaryQuery(req);

    // Determine sort object
    let sortField = sort as string;
    const sortOrder = order === "asc" ? 1 : -1;
    const sortObj: any = {};
    
    // Add secondary sort for stability
    if (sortField === "hhid") {
      sortObj["hhid"] = sortOrder;
      sortObj["createdAt"] = -1;
    } else {
      sortObj[sortField] = sortOrder;
      if (sortField !== "createdAt") {
        sortObj["createdAt"] = -1;
      }
    }
    sortObj["_id"] = -1; // Final fallback for absolute stability

    const pageNum = parseInt(page as string);
    const limitNum = limit === "all" ? 0 : parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    let beneficiaries;
    let total;

    if (limit === "all") {
      beneficiaries = await Beneficiary.find(query).sort(sortObj);
      total = beneficiaries.length;
    } else {
      [beneficiaries, total] = await Promise.all([
        Beneficiary.find(query).sort(sortObj).skip(skip).limit(limitNum),
        Beneficiary.countDocuments(query)
      ]);
    }

    // Fetch Redemption and NES counts for each beneficiary using beneficiary_id and hhid
    const beneficiaryIds = beneficiaries.map(b => b._id.toString());
    const hhids = beneficiaries.map(b => b.hhid).filter(h => !!h && h !== "0" && h !== "");
    const beneficiaryIdObjs = beneficiaryIds.map(id => {
      try {
        return new (require('mongoose').Types.ObjectId)(id);
      } catch (e) {
        return null;
      }
    }).filter(id => id !== null);

    // If frm_period is provided, fetch specific records for this period
    let periodRedemptions: any[] = [];
    let periodNesRecords: any[] = [];
    if (frm_period) {
      const escapedPeriod = escapeRegex((frm_period as string).trim());
      const periodMatch = { $regex: new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i") };
      const [reds, nes] = await Promise.all([
        Redemption.find({
          frm_period: periodMatch,
          $or: [
            { beneficiary_id: { $in: beneficiaryIds } },
            { beneficiary_id: { $in: beneficiaryIdObjs } },
            { hhid: { $in: hhids } }
          ]
        }).lean(),
        NES.find({
          frm_period: periodMatch,
          $or: [
            { beneficiary_id: { $in: beneficiaryIds } },
            { beneficiary_id: { $in: beneficiaryIdObjs } },
            { hhid: { $in: hhids } }
          ]
        }).lean()
      ]);
      periodRedemptions = reds.map(r => ({ ...r, type: 'redemption' }));
      periodNesRecords = nes.map(r => ({ ...r, type: 'nes' }));
    }

    const [redemptionStats, nesStats] = await Promise.all([
      Redemption.aggregate([
        { 
          $match: { 
            $or: [
              { beneficiary_id: { $in: beneficiaryIds } },
              { beneficiary_id: { $in: beneficiaryIdObjs } },
              { hhid: { $in: hhids } }
            ]
          } 
        },
        // Join with beneficiaries to ensure we group by the correct canonical ID
        {
          $lookup: {
            from: "beneficiaries",
            let: { b_id: "$beneficiary_id", h_id: "$hhid" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$_id", "$$b_id"] },
                      { $eq: [{ $toString: "$_id" }, { $toString: "$$b_id" }] },
                      { 
                        $and: [
                          { $ne: ["$$h_id", ""] },
                          { $ne: ["$$h_id", null] },
                          { $ne: ["$$h_id", "0"] },
                          { $eq: ["$hhid", "$$h_id"] }
                        ]
                      }
                    ]
                  }
                }
              },
               { $project: { _id: 1 } },
               { $limit: 1 }
            ],
            as: "matched_ben"
          }
        },
        { $unwind: "$matched_ben" },
        {
          $group: {
            _id: { $toString: "$matched_ben._id" },
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
            },
            periods: { $addToSet: "$frm_period" }
          }
        }
      ]),
      NES.aggregate([
        { 
          $match: { 
            $or: [
              { beneficiary_id: { $in: beneficiaryIds } },
              { beneficiary_id: { $in: beneficiaryIdObjs } },
              { hhid: { $in: hhids } }
            ]
          } 
        },
        // Join with beneficiaries to ensure we group by the correct canonical ID
        {
          $lookup: {
            from: "beneficiaries",
            let: { b_id: "$beneficiary_id", h_id: "$hhid" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$_id", "$$b_id"] },
                      { $eq: [{ $toString: "$_id" }, { $toString: "$$b_id" }] },
                      { 
                        $and: [
                          { $ne: ["$$h_id", ""] },
                          { $ne: ["$$h_id", null] },
                          { $ne: ["$$h_id", "0"] },
                          { $eq: ["$hhid", "$$h_id"] }
                        ]
                      }
                    ]
                  }
                }
              },
               { $project: { _id: 1 } },
               { $limit: 1 }
            ],
            as: "matched_ben"
          }
        },
        { $unwind: "$matched_ben" },
        {
          $group: {
            _id: { $toString: "$matched_ben._id" },
            present: {
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
            },
            periods: { $addToSet: "$frm_period" }
          }
        }
      ])
    ]);

    const redemptionMap = new Map(redemptionStats.map(s => [s._id, s]));
    const nesMap = new Map(nesStats.map(s => [s._id, s]));

    // Map period redemptions by beneficiary ID and HHID for fast lookup
    const periodRedemptionMap = new Map();
    [...periodRedemptions, ...periodNesRecords].forEach(r => {
      if (r.beneficiary_id) {
        periodRedemptionMap.set(r.beneficiary_id.toString(), r);
      }
      // Only map by HHID if it's not a placeholder like "0"
      if (r.hhid && r.hhid !== "0" && r.hhid !== "") {
        periodRedemptionMap.set(r.hhid, r);
      }
    });

    const beneficiariesWithStats = beneficiaries.map(b => {
      const id = b._id.toString();
      const hhid = b.hhid;
      
      // Find redemption for this period (prefer ID match over HHID match)
      // Only match by HHID if it's not a placeholder like "0"
      const hhidMatch = (hhid && hhid !== "0" && hhid !== "") ? periodRedemptionMap.get(hhid) : null;
      const current_redemption = periodRedemptionMap.get(id) || hhidMatch;

      const benObj = b.toObject();
      
      // Normalize area names in the response
      benObj.region = normalizeArea(benObj.region);
      benObj.province = normalizeArea(benObj.province);
      benObj.municipality = normalizeArea(benObj.municipality);
      benObj.barangay = normalizeArea(benObj.barangay);

      return {
        ...benObj,
        redemption_stats: redemptionMap.get(id) || { redeemed: 0, unredeemed: 0 },
        nes_stats: nesMap.get(id) || { present: 0, absent: 0 },
        current_redemption: current_redemption || null
      };
    });

    res.status(200).json({
      beneficiaries: beneficiariesWithStats,
      total,
      page: pageNum,
      totalPages: limit === "all" ? 1 : Math.ceil(total / limitNum)
    });
  }
);

export const getExportData = catchAsync(
  async (req: Request, res: Response) => {
    const { 
      sort = "last_name", 
      order = "asc",
      frm_period
    } = req.query;

    const query = await buildBeneficiaryQuery(req);

    // Determine sort object
    let sortField = sort as string;
    const sortOrder = order === "asc" ? 1 : -1;
    const sortObj: any = {};
    sortObj[sortField] = sortOrder;
    sortObj["_id"] = -1;

    // Fetch all beneficiaries matching the query
    const beneficiaries = await Beneficiary.find(query).sort(sortObj);
    
    if (beneficiaries.length === 0) {
      return res.status(200).json({ data: [] });
    }

    const beneficiaryIds = beneficiaries.map(b => b._id.toString());
    const hhids = beneficiaries.map(b => b.hhid).filter(h => !!h && h !== "0" && h !== "");
    const beneficiaryIdObjs = beneficiaryIds.map(id => {
      try {
        return new (require('mongoose').Types.ObjectId)(id);
      } catch (e) {
        return null;
      }
    }).filter(id => id !== null);

    // Fetch current period records
    let periodRedemptions: any[] = [];
    let periodNesRecords: any[] = [];
    if (frm_period) {
      const escapedPeriod = escapeRegex((frm_period as string).trim());
      const periodMatch = { $regex: new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i") };
      const [reds, nes] = await Promise.all([
        Redemption.find({
          frm_period: periodMatch,
          $or: [
            { beneficiary_id: { $in: beneficiaryIds } },
            { beneficiary_id: { $in: beneficiaryIdObjs } },
            { hhid: { $in: hhids } }
          ]
        }).lean(),
        NES.find({
          frm_period: periodMatch,
          $or: [
            { beneficiary_id: { $in: beneficiaryIds } },
            { beneficiary_id: { $in: beneficiaryIdObjs } },
            { hhid: { $in: hhids } }
          ]
        }).lean()
      ]);
      periodRedemptions = reds;
      periodNesRecords = nes;
    }

    // Aggregate stats for ALL time (for percentages)
    const [redemptionStats, nesStats] = await Promise.all([
      Redemption.aggregate([
        { 
          $match: { 
            $or: [
              { beneficiary_id: { $in: beneficiaryIds } },
              { beneficiary_id: { $in: beneficiaryIdObjs } },
              { hhid: { $in: hhids } }
            ]
          } 
        },
        {
          $lookup: {
            from: "beneficiaries",
            let: { b_id: "$beneficiary_id", h_id: "$hhid" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$_id", "$$b_id"] },
                      { $eq: [{ $toString: "$_id" }, { $toString: "$$b_id" }] },
                      { 
                        $and: [
                          { $ne: ["$$h_id", ""] },
                          { $ne: ["$$h_id", null] },
                          { $ne: ["$$h_id", "0"] },
                          { $eq: ["$hhid", "$$h_id"] }
                        ]
                      }
                    ]
                  }
                }
              },
               { $project: { _id: 1 } },
               { $limit: 1 }
            ],
            as: "matched_ben"
          }
        },
        { $unwind: "$matched_ben" },
        {
          $group: {
            _id: { $toString: "$matched_ben._id" },
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
      ]),
      NES.aggregate([
        { 
          $match: { 
            $or: [
              { beneficiary_id: { $in: beneficiaryIds } },
              { beneficiary_id: { $in: beneficiaryIdObjs } },
              { hhid: { $in: hhids } }
            ]
          } 
        },
        {
          $lookup: {
            from: "beneficiaries",
            let: { b_id: "$beneficiary_id", h_id: "$hhid" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$_id", "$$b_id"] },
                      { $eq: [{ $toString: "$_id" }, { $toString: "$$b_id" }] },
                      { 
                        $and: [
                          { $ne: ["$$h_id", ""] },
                          { $ne: ["$$h_id", null] },
                          { $ne: ["$$h_id", "0"] },
                          { $eq: ["$hhid", "$$h_id"] }
                        ]
                      }
                    ]
                  }
                }
              },
               { $project: { _id: 1 } },
               { $limit: 1 }
            ],
            as: "matched_ben"
          }
        },
        { $unwind: "$matched_ben" },
        {
          $group: {
            _id: { $toString: "$matched_ben._id" },
            present: {
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
      ])
    ]);

    const redemptionMap = new Map(redemptionStats.map(s => [s._id, s]));
    const nesMap = new Map(nesStats.map(s => [s._id, s]));

    const periodRedemptionMap = new Map();
    periodRedemptions.forEach(r => {
      if (r.beneficiary_id) periodRedemptionMap.set(r.beneficiary_id.toString(), r);
      if (r.hhid && r.hhid !== "0" && r.hhid !== "") periodRedemptionMap.set(r.hhid, r);
    });

    const periodNesMap = new Map();
    periodNesRecords.forEach(r => {
      if (r.beneficiary_id) periodNesMap.set(r.beneficiary_id.toString(), r);
      if (r.hhid && r.hhid !== "0" && r.hhid !== "") periodNesMap.set(r.hhid, r);
    });

    const exportData = beneficiaries.map(b => {
      const id = b._id.toString();
      const hhid = b.hhid;
      
      const redStat = redemptionMap.get(id) || { redeemed: 0, unredeemed: 0 };
      const nesStat = nesMap.get(id) || { present: 0, absent: 0 };
      
      const redTotal = redStat.redeemed + redStat.unredeemed;
      const nesTotal = nesStat.present + nesStat.absent;
      
      const redemptionRate = redTotal > 0 ? (redStat.redeemed / redTotal) * 100 : 0;
      const nesRate = nesTotal > 0 ? (nesStat.present / nesTotal) * 100 : 0;

      const hhidMatchRed = (hhid && hhid !== "0" && hhid !== "") ? periodRedemptionMap.get(hhid) : null;
      const currentRed = periodRedemptionMap.get(id) || hhidMatchRed;

      const hhidMatchNes = (hhid && hhid !== "0" && hhid !== "") ? periodNesMap.get(hhid) : null;
      const currentNes = periodNesMap.get(id) || hhidMatchNes;

      return {
        "HHID": b.hhid,
        "Last Name": b.last_name,
        "First Name": b.first_name,
        "Middle Name": b.middle_name || "",
        "Region": normalizeArea(b.region),
        "Province": normalizeArea(b.province),
        "Municipality": normalizeArea(b.municipality),
        "Barangay": normalizeArea(b.barangay),
        "Status": b.status,
        "HH Members 0-18": b.num_hh_0_18 || 0,
        "HH Members Pregnant": b.num_hh_pregnant || 0,
        "HH Members Lactating": b.num_hh_lactating || 0,
        "HH Members PWD": b.num_hh_pwd || 0,
        "PWD Types": (b.pwd_types || []).map((t: any) => `${t.type} (${t.count})`).join(", "),
        "HH Members 60+": b.num_hh_60_above || 0,
        "HH Members Solo Parent": b.num_hh_solo_parent || 0,
        "FRM Period": frm_period || "N/A",
        "Redemption Status": currentRed?.attendance || "none",
        "Redemption Rate (%)": redemptionRate.toFixed(2),
        "NES Attendance": currentNes?.attendance || "none",
        "NES Rate (%)": nesRate.toFixed(2),
        "Remarks": currentRed?.action || currentNes?.action || "",
        "Reason": currentRed?.reason || currentNes?.reason || "",
        "Date Recorded": currentRed?.date_recorded || currentNes?.date_recorded || ""
      };
    });

    res.status(200).json({ data: exportData });
  }
);

export const normalizeAllAreaNames = catchAsync(
  async (req: Request, res: Response) => {
    const beneficiaries = await Beneficiary.find({});
    let bUpdates = 0;
    
    for (const b of beneficiaries) {
      let changed = false;
      const fields = ['region', 'province', 'municipality', 'barangay'] as const;
      
      for (const field of fields) {
        if (b[field]) {
          const normalized = normalizeArea(b[field]);
          if (normalized !== b[field]) {
            (b as any)[field] = normalized;
            changed = true;
          }
        }
      }

      if (changed) {
        await b.save();
        bUpdates++;
      }
    }

    // Also normalize the Area collection
    const areas = await Area.find({});
    let aUpdates = 0;
    for (const a of areas) {
      if (a.name) {
        const normalized = normalizeArea(a.name);
        if (normalized !== a.name) {
          a.name = normalized;
          await a.save();
          aUpdates++;
        }
      }
    }

    await logAudit(req, "MAINTENANCE", "system", "all", "", `Normalized area names: ${bUpdates} beneficiaries, ${aUpdates} areas`);

    res.status(200).json({
      message: "Normalization complete",
      beneficiaries_updated: bUpdates,
      areas_updated: aUpdates
    });
  }
);

export const createBeneficiary = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    // Check area authorization for non-admin users
    if (user.role !== "admin") {
      if (!user.assigned_areas || user.assigned_areas.length === 0) {
        return next(new ErrorHandler("You are not assigned to any areas and cannot create beneficiaries", 403));
      }

      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        // Check manually against authorized areas
        const assignedAreas = await Area.find({
          $or: [
            { _id: { $in: user.assigned_areas.map((a: any) => typeof a === 'object' ? a._id : a).filter((id: any) => id && id.toString().match(/^[0-9a-fA-F]{24}$/)) } },
            { name: { $in: user.assigned_areas.map((a: any) => typeof a === 'object' ? a.name : a) } }
          ]
        });

        const isMatch = assignedAreas.some(area => {
          const escapedName = area.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`^${escapedName}$`, "i");
          if (area.type === 'region') return regex.test(req.body.region || "");
          if (area.type === 'province') return regex.test(req.body.province || "");
          if (area.type === 'municipality') return regex.test(req.body.municipality || "");
          if (area.type === 'barangay') return regex.test(req.body.barangay || "");
          return false;
        });

        if (!isMatch) {
          return next(new ErrorHandler("You are not authorized to create beneficiaries in this area", 403));
        }
      }
    }

    // Check for duplicates (combination of 7 fields)
    const duplicateQuery = {
      first_name: { $regex: new RegExp(`^${(req.body.first_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
      last_name: { $regex: new RegExp(`^${(req.body.last_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
      middle_name: { $regex: new RegExp(`^${(req.body.middle_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
      birthdate: req.body.birthdate || "",
      barangay: { $regex: new RegExp(`^${(req.body.barangay || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
      municipality: { $regex: new RegExp(`^${(req.body.municipality || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
      province: { $regex: new RegExp(`^${(req.body.province || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
    };

    const existing = await Beneficiary.findOne(duplicateQuery);
    if (existing) {
      return next(new ErrorHandler("A beneficiary with the same name, birthdate, and address already exists", 400));
    }

    // Standardize area names before saving
    await standardizeAreaNames(req.body);

    // Auto-populate region if province is provided but region is missing
    if (req.body.province && !req.body.region) {
      if (req.body.province.toUpperCase() === "CITY OF BACOLOD") {
        req.body.region = "NEGROS ISLAND REGION (NIR)";
      } else {
        const provinceArea = await Area.findOne({ 
          name: { $regex: new RegExp(`^${(req.body.province as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }, 
          type: "province" 
        }).populate("parent_id");
        
        if (provinceArea && provinceArea.parent_id && (provinceArea.parent_id as any).name) {
          req.body.region = (provinceArea.parent_id as any).name;
        } else if (provinceArea && provinceArea.parent_code) {
          const regionArea = await Area.findOne({ code: provinceArea.parent_code, type: "region" });
          if (regionArea) req.body.region = regionArea.name;
        }
      }
    }

    const beneficiary = await Beneficiary.create(req.body);
    await logAudit(req, "CREATE", "beneficiaries", beneficiary.id, "", JSON.stringify(beneficiary));
    res.status(201).json(beneficiary);
  }
);

export const bulkCreateBeneficiaries = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { beneficiaries } = req.body;
    if (!beneficiaries || !Array.isArray(beneficiaries)) {
      return next(new ErrorHandler("Invalid beneficiaries data", 400));
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    // Split into chunks for better performance and to avoid memory issues
    // Reduced chunk size to 500 to avoid connection timeouts during large imports
    const chunkSize = 500;
    
    // Pre-fetch all provinces and regions to avoid thousands of DB queries
    const allProvinces = await Area.find({ type: "province" }).populate("parent_id");
    const provinceToRegionMap = new Map<string, string>();
    const provinceStandardMap = new Map<string, string>();
    
    allProvinces.forEach((p: any) => {
      const canonicalName = p.name;
      const provinceName = p.name.toUpperCase();
      provinceStandardMap.set(provinceName, canonicalName);
      
      let regionName = "";
      if (p.parent_id && p.parent_id.name) {
        regionName = p.parent_id.name;
      }
      if (regionName) {
        provinceToRegionMap.set(provinceName, regionName);
      }
    });

    // Pre-fetch all municipalities for standardization
    const allMunicipalities = await Area.find({ type: "municipality" });
    const muniMap = new Map<string, string>();
    
    allMunicipalities.forEach((m: any) => {
      const canonicalName = m.name;
      const val = m.name.trim();
      muniMap.set(val.toUpperCase(), canonicalName);
      
      const cityMatch = val.match(/^(city of\s+)?(.+?)(\s+city)?(\s*\(.+?\))?$/i);
      const muniMatch = val.match(/^(municipality of\s+)?(.+?)(\s+municipality)?(\s*\(.+?\))?$/i);
      
      if (cityMatch && cityMatch[2]) {
        const core = cityMatch[2].toUpperCase();
        muniMap.set(core, canonicalName);
        muniMap.set(`${core} CITY`, canonicalName);
        muniMap.set(`CITY OF ${core}`, canonicalName);
      } else if (muniMatch && muniMatch[2]) {
        const core = muniMatch[2].toUpperCase();
        muniMap.set(core, canonicalName);
        muniMap.set(`${core} MUNICIPALITY`, canonicalName);
        muniMap.set(`MUNICIPALITY OF ${core}`, canonicalName);
      }
    });

    // Proactively drop old HHID unique index if it exists (ignoring errors if it doesn't)
    // This ensures we don't have stray restrictions from previous versions
    await Beneficiary.collection.dropIndex("hhid_1").catch(() => {});

    for (let i = 0; i < beneficiaries.length; i += chunkSize) {
      const chunk = beneficiaries.slice(i, i + chunkSize);
      
      // 1. Auto-populate missing regions & Validate each document
      const validDocs: any[] = [];
      
      for (let j = 0; j < chunk.length; j++) {
        const b = chunk[j];
        
        // Standardize municipality
        if (b.municipality) {
          const muniKey = b.municipality.trim().toUpperCase();
          if (muniMap.has(muniKey)) {
            b.municipality = muniMap.get(muniKey);
          }
        }

        // Standardize province
        if (b.province) {
          const provinceKey = b.province.trim().toUpperCase();
          if (provinceStandardMap.has(provinceKey)) {
            b.province = provinceStandardMap.get(provinceKey);
          }
        }

        // Auto-populate missing regions using the map
        if (b.province && !b.region) {
          const provinceKey = b.province.toUpperCase();
          if (provinceToRegionMap.has(provinceKey)) {
            b.region = provinceToRegionMap.get(provinceKey);
          }
        }

        // Validate sync
        const doc = new Beneficiary(b);
        const validationError = doc.validateSync();
        
        if (validationError) {
          results.failed++;
          if (results.errors.length < 50) {
            const errorMsgs = Object.values(validationError.errors).map(e => e.message).join(", ");
            results.errors.push(`Row ${i + j + 1}: ${errorMsgs}`);
          }
        } else {
          validDocs.push(b);
        }
      }
      
      if (validDocs.length === 0) continue;

      const bulkOps = validDocs.map(b => {
        // Create filter for upsert
        let filter: any = {};
        if (b.hhid) {
          filter.hhid = b.hhid;
        } else {
          // Fallback to name/birthdate/location match if HHID is missing
          filter = {
            first_name: { $regex: new RegExp(`^${(b.first_name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
            last_name: { $regex: new RegExp(`^${(b.last_name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
            birthdate: b.birthdate || "",
            barangay: { $regex: new RegExp(`^${(b.barangay || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
            municipality: b.municipality || ""
          };
        }

        return {
          updateOne: {
            filter,
            update: { $set: b },
            upsert: true
          }
        };
      });

      try {
        const result = await Beneficiary.bulkWrite(bulkOps, { ordered: false });
        results.success += (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0);
      } catch (error: any) {
        // Handle partial success/errors in bulkWrite
        if (error.result) {
          results.success += (error.result.nUpserted || 0) + (error.result.nModified || 0) + (error.result.nMatched || 0);
          results.failed += (validDocs.length - (error.result.nUpserted || 0) - (error.result.nModified || 0) - (error.result.nMatched || 0));
        }

        if (error.writeErrors) {
          error.writeErrors.forEach((err: any) => {
            if (results.errors.length < 50) {
              results.errors.push(`Row ${i + (err.index || 0) + 1}: ${err.errmsg || 'Unknown database error'}`);
            }
          });
        } else if (!error.result) {
          results.failed += validDocs.length;
          if (results.errors.length < 50) {
            results.errors.push(`Chunk starting at row ${i + 1}: ${error.message || 'Unknown error'}`);
          }
        }
      }
    }

    await logAudit(req, "BULK_CREATE", "beneficiaries", "multiple", "", `Imported ${results.success} beneficiaries, ${results.failed} failed`);

    res.status(201).json(results);
  }
);

export const checkDuplicates = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { beneficiaries } = req.body;
    if (!beneficiaries || !Array.isArray(beneficiaries)) {
      return next(new ErrorHandler("Invalid request body", 400));
    }

    const duplicates: any[] = [];
    const chunkSize = 50; // Much smaller chunk size for complex $or query with regex to avoid timeouts
    
    for (let i = 0; i < beneficiaries.length; i += chunkSize) {
      const chunk = beneficiaries.slice(i, i + chunkSize);
      
      const query = {
        $or: chunk.map(b => {
           const muniVal = (b.municipality || '').trim();
           const cityMatch = muniVal.match(/^(city of\s+)?(.+?)(\s+city)?(\s*\(.+?\))?$/i);
           const muniMatch = muniVal.match(/^(municipality of\s+)?(.+?)(\s+municipality)?(\s*\(.+?\))?$/i);
           const core = (cityMatch?.[2] || muniMatch?.[2] || muniVal).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
           const muniPattern = `^((city of\\s+)?${core}(\\s+city)?|(municipality of\\s+)?${core}(\\s+municipality)?)(\\s*\\(.+?\\))?$`;

           return {
            first_name: { $regex: new RegExp(`^${(b.first_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            last_name: { $regex: new RegExp(`^${(b.last_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            middle_name: { $regex: new RegExp(`^${(b.middle_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            birthdate: b.birthdate || "",
            barangay: { $regex: new RegExp(`^${(b.barangay || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            municipality: { $regex: new RegExp(muniPattern, "i") },
            province: { $regex: new RegExp(`^${(b.province || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
          };
        })
      };

      const existing = await Beneficiary.find(query, "hhid first_name last_name middle_name birthdate barangay municipality province");
      duplicates.push(...existing);
    }

    res.status(200).json({
      duplicates
    });
  }
);

export const updateBeneficiary = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    
    const query: any = { _id: req.params.id };
    if (user.role !== "admin") {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        query.$and = [areaFilter];
      } else {
        return next(new ErrorHandler("You are not assigned to any areas and cannot update beneficiaries", 403));
      }
    }

    const beneficiary = await Beneficiary.findOne(query);
    if (!beneficiary) {
      return next(new ErrorHandler("Beneficiary not found or you are not authorized to update it", 404));
    }

    const oldData = JSON.stringify(beneficiary);

    // If area is being changed, check if the new area is also authorized
    if (user.role !== "admin" && (req.body.region || req.body.province || req.body.municipality || req.body.barangay)) {
      const assignedAreas = await Area.find({
        $or: [
          { _id: { $in: user.assigned_areas.map((a: any) => typeof a === 'object' ? a._id : a).filter((id: any) => id && id.toString().match(/^[0-9a-fA-F]{24}$/)) } },
          { name: { $in: user.assigned_areas.map((a: any) => typeof a === 'object' ? a.name : a) } }
        ]
      });

      const updatedData = { ...beneficiary.toObject(), ...req.body };
      
      const isMatch = assignedAreas.some(area => {
        const escapedName = area.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^${escapedName}$`, "i");
        if (area.type === 'region') return regex.test(updatedData.region || "");
        if (area.type === 'province') return regex.test(updatedData.province || "");
        if (area.type === 'municipality') return regex.test(updatedData.municipality || "");
        if (area.type === 'barangay') return regex.test(updatedData.barangay || "");
        return false;
      });

      if (!isMatch) {
        return next(new ErrorHandler("You are not authorized to move a beneficiary to this area", 403));
      }
    }

    // Standardize area names before saving
    await standardizeAreaNames(req.body);

    // Auto-populate region if province is changed but region is not provided or needs update
    if (req.body.province && (req.body.province !== beneficiary.province || !beneficiary.region)) {
      if (req.body.province.toUpperCase() === "CITY OF BACOLOD") {
        req.body.region = "NEGROS ISLAND REGION (NIR)";
      } else {
        const provinceArea = await Area.findOne({ 
          name: { $regex: new RegExp(`^${(req.body.province as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }, 
          type: "province" 
        }).populate("parent_id");
        
        if (provinceArea && provinceArea.parent_id && (provinceArea.parent_id as any).name) {
          req.body.region = (provinceArea.parent_id as any).name;
        } else if (provinceArea && provinceArea.parent_code) {
          const regionArea = await Area.findOne({ code: provinceArea.parent_code, type: "region" });
          if (regionArea) req.body.region = regionArea.name;
        }
      }
    }

    Object.assign(beneficiary, req.body);
    await beneficiary.save();

    await logAudit(req, "UPDATE", "beneficiaries", beneficiary.id, oldData, JSON.stringify(beneficiary));

    res.status(200).json(beneficiary);
  }
);

export const deleteBeneficiary = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    
    const query: any = { _id: req.params.id };
    if (user.role !== "admin") {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        query.$and = [areaFilter];
      } else {
        return next(new ErrorHandler("You are not assigned to any areas and cannot delete beneficiaries", 403));
      }
    }

    const beneficiary = await Beneficiary.findOne(query);
    if (!beneficiary) {
      return next(new ErrorHandler("Beneficiary not found", 404));
    }

    const oldData = JSON.stringify(beneficiary);
    await beneficiary.deleteOne();

    await logAudit(req, "DELETE", "beneficiaries", beneficiary.id, oldData, "");

    res.status(200).json({ message: "Beneficiary deleted" });
  }
);

export const bulkDeleteBeneficiaries = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { ids, all, filters } = req.body;

    let deleteQuery: any = {};

    // Filter by user's assigned areas if not admin
    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        deleteQuery.$and = [areaFilter];
      }
    }

    if (all) {
      // If deleting all based on filters
      if (filters) {
        deleteQuery = await buildBeneficiaryQuery(req, filters);
      }
    } else {
      // If deleting specific IDs
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return next(new ErrorHandler("No IDs provided for deletion", 400));
      }
      if (deleteQuery.$and) {
        deleteQuery.$and.push({ _id: { $in: ids } });
      } else {
        deleteQuery._id = { $in: ids };
      }
    }

    const result = await Beneficiary.deleteMany(deleteQuery);

    await logAudit(req, "BULK_DELETE", "beneficiaries", "multiple", "", `Deleted ${result.deletedCount} beneficiaries`);

    res.status(200).json({
      success: true,
      count: result.deletedCount,
    });
  }
);

export const getAvailableFilters = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    let query: any = {};

    if (user.role !== "admin" && user.assigned_areas && user.assigned_areas.length > 0) {
      const areaFilter = await getAreaFilter(user.assigned_areas);
      if (areaFilter) {
        query = areaFilter;
      }
    }

    const regions = await Beneficiary.distinct("region", query);
    const provinces = await Beneficiary.distinct("province", query);
    const municipalities = await Beneficiary.distinct("municipality", query);
    const barangays = await Beneficiary.distinct("barangay", query);

    // Get available FRM periods
    const [redemptionPeriods, nesPeriods] = await Promise.all([
      Redemption.distinct("frm_period"),
      NES.distinct("frm_period")
    ]);
    const periods = [...new Set([...redemptionPeriods, ...nesPeriods])]
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a)); // Sort descending (newest first)

    // Normalize and remove duplicates
    const normalizeList = (list: string[]) => {
      const normalized = list.map(item => normalizeArea(item)).filter(Boolean);
      return [...new Set(normalized)].sort();
    };

    res.status(200).json({
      regions: normalizeList(regions),
      provinces: normalizeList(provinces),
      municipalities: normalizeList(municipalities),
      barangays: normalizeList(barangays),
      periods: periods
    });
  }
);

