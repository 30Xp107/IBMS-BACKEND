import { Area } from "../models/area.model";

export const getAreaFilter = async (assigned_areas: string[]) => {
  if (!assigned_areas || assigned_areas.length === 0) {
    return null;
  }

  // Find areas by ID or name (for backward compatibility)
  const assignedAreas = await Area.find({
    $or: [
      { _id: { $in: assigned_areas.filter((id: string) => id.match(/^[0-9a-fA-F]{24}$/)) } },
      { name: { $in: assigned_areas } }
    ]
  }).populate({
    path: 'parent_id',
    populate: { path: 'parent_id' }
  });

  if (assignedAreas.length === 0) {
    return null;
  }

  const orConditions = assignedAreas.map(area => {
    const condition: any = {};
    if (area.type === 'province') {
      condition.province = area.name;
    } else if (area.type === 'municipality') {
      condition.municipality = area.name;
      if (area.parent_id) {
        condition.province = (area.parent_id as any).name;
      }
    } else if (area.type === 'barangay') {
      condition.barangay = area.name;
      if (area.parent_id) {
        condition.municipality = (area.parent_id as any).name;
        if ((area.parent_id as any).parent_id) {
          condition.province = ((area.parent_id as any).parent_id as any).name;
        }
      }
    }
    return condition;
  });

  return { $or: orConditions };
};
