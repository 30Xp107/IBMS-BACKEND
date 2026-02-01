import { Area } from "../models/area.model";

// Simple in-memory cache for area filters
const filterCache = new Map<string, { filter: any, timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const getAreaFilter = async (assigned_areas: any[]) => {
  try {
    if (!assigned_areas || assigned_areas.length === 0) {
      return null;
    }

    // Create a cache key from normalized area identifiers
    const cacheKey = assigned_areas.map(a => String(a?._id || a?.id || a)).sort().join('|');
    const cached = filterCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      return cached.filter;
    }

    // Normalize all area references to strings (IDs, names, or codes)
    const areaStrings = assigned_areas.map(area => {
      if (!area) return "";
      if (typeof area === 'string') return area;
      if (area && (area._id || area.id)) return String(area._id || area.id);
      return String(area);
    }).filter(s => s !== "");

    if (areaStrings.length === 0) return null;

    // Find areas by ID, name, or code
    const assignedAreas = await Area.find({
      $or: [
        { _id: { $in: areaStrings.filter(id => id && typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/)) } },
        { code: { $in: areaStrings } },
        { name: { $in: areaStrings } }
      ]
    }).populate({
      path: 'parent_id',
      populate: { 
        path: 'parent_id',
        populate: { path: 'parent_id' }
      }
    });

    if (assignedAreas.length === 0) {
      return null;
    }

    const orConditions = assignedAreas.map(area => {
      const condition: any = {};
      const val = area.name.trim();
      const escapedName = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      if (area.type === 'region') {
        condition.region = { $regex: new RegExp(`^\\s*${escapedName}\\s*$`, "i") };
      } else if (area.type === 'province') {
        condition.province = { $regex: new RegExp(`^\\s*${escapedName}\\s*$`, "i") };
      } else if (area.type === 'municipality') {
        // Handle "City of X" or "X City" or just "X" and optional suffixes in parentheses
        const cityMatch = val.match(/^(city of\s+)?(.+?)(\s+city)?(\s*\(.+?\))?$/i);
        const muniMatch = val.match(/^(municipality of\s+)?(.+?)(\s+municipality)?(\s*\(.+?\))?$/i);
        
        const core = (cityMatch?.[2] || muniMatch?.[2] || val).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = `^\\s*((city of\\s+)?${core}(\\s+city)?|(municipality of\\s+)?${core}(\\s+municipality)?)(\\s*\\(.+?\\))?\\s*$`;
        
        condition.municipality = { $regex: new RegExp(pattern, "i") };
      } else if (area.type === 'barangay') {
        condition.barangay = { $regex: new RegExp(`^\\s*${escapedName}\\s*$`, "i") };
      }
      return condition;
    });

    const finalFilter = orConditions.length > 0 ? { $or: orConditions } : null;
    
    // Store in cache
    filterCache.set(cacheKey, { filter: finalFilter, timestamp: Date.now() });
    
    return finalFilter;
  } catch (error) {
    console.error("Error in getAreaFilter:", error);
    return null;
  }
};
