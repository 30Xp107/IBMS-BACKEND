import { Area } from "../models/area.model";

export const getAreaFilter = async (assigned_areas: any[]) => {
  try {
    if (!assigned_areas || assigned_areas.length === 0) {
      return null;
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
      const escapedName = area.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (area.type === 'region') {
        condition.region = { $regex: new RegExp(`^${escapedName}$`, "i") };
      } else if (area.type === 'province') {
        condition.province = { $regex: new RegExp(`^${escapedName}$`, "i") };
      } else if (area.type === 'municipality') {
        condition.municipality = { $regex: new RegExp(`^${escapedName}$`, "i") };
      } else if (area.type === 'barangay') {
        condition.barangay = { $regex: new RegExp(`^${escapedName}$`, "i") };
      }
      return condition;
    });

    return orConditions.length > 0 ? { $or: orConditions } : null;
  } catch (error) {
    console.error("Error in getAreaFilter:", error);
    return null;
  }
};
