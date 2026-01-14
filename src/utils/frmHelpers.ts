import { SystemConfig } from "../models/systemConfig.model";

export interface IFrmSchedule {
  name: string;
  startDate: string;
  endDate: string;
}

/**
 * Gets the FRM period name for a given date based on custom schedules.
 * Falls back to monthly format (e.g. "January 2026") if no custom schedule matches.
 */
export const getFrmPeriod = async (date: Date = new Date()): Promise<string> => {
  try {
    const config = await SystemConfig.findOne({ key: "frm_schedules" });
    
    if (config && Array.isArray(config.value)) {
      const schedules: IFrmSchedule[] = config.value;
      
      // Find a schedule that contains the given date
      const match = schedules.find(s => {
        const start = new Date(s.startDate);
        const end = new Date(s.endDate);
        // Set to start of day for start and end of day for end to be inclusive
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        return date >= start && date <= end;
      });

      if (match) {
        return match.name;
      }
    }
  } catch (error) {
    console.error("Error fetching FRM schedules:", error);
  }

  // Fallback to monthly format
  return `${date.toLocaleString("default", { month: "long" })} ${date.getFullYear()}`;
};

/**
 * Gets all available FRM periods (custom + historical monthly ones)
 */
export const getAllFrmPeriods = async (): Promise<string[]> => {
  const periods = new Set<string>();

  try {
    // Add custom schedules
    const config = await SystemConfig.findOne({ key: "frm_schedules" });
    if (config && Array.isArray(config.value)) {
      config.value.forEach((s: IFrmSchedule) => periods.add(s.name));
    }
  } catch (error) {
    console.error("Error fetching FRM schedules:", error);
  }

  // We don't necessarily want to add ALL historical months here as it might be too many.
  // Usually the UI will provide its own list or we can fetch unique periods from database.
  
  return Array.from(periods);
};
