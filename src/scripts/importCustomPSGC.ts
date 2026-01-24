import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { Area } from "../models/area.model";
import connectDB from "../utils/database";

dotenv.config();

async function importData() {
  try {
    console.log("MONGODB_URI:", process.env.MONGODB_URI?.substring(0, 30) + "...");
    await connectDB();
    console.log("Connected to database:", mongoose.connection.db?.databaseName);

    const csvPath = path.resolve(__dirname, "../../psgc_data.csv");
    const fileContent = fs.readFileSync(csvPath, "utf-8");
    
    const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== "");
    const header = lines[0].split(",");
    
    // Mapping column names to indices
    const col = (name: string) => header.indexOf(name);
    
    const idxRegion = col("region_name2025");
    const idxRegionCode = col("region_code2025");
    const idxProvince = col("prov_name2025");
    const idxProvinceCode = col("prov_code2025");
    const idxMuni = col("citymun_name2025");
    const idxMuniCode = col("citymun_code2025");
    const idxBrgy = col("barangay_name2025");
    const idxBrgyCode = col("barangay_code2025");

    console.log(`Processing ${lines.length - 1} lines...`);

    const regions = new Map();
    const provinces = new Map();
    const municipalities = new Map();
    const barangays: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(p => p.trim().replace(/"/g, ''));
      
      const regionName = parts[idxRegion];
      const regionCode = parts[idxRegionCode];
      const provinceName = parts[idxProvince];
      const provinceCode = parts[idxProvinceCode];
      const municipalityName = parts[idxMuni];
      const municipalityCode = parts[idxMuniCode];
      const barangayName = parts[idxBrgy];
      const barangayCode = parts[idxBrgyCode];

      if (regionCode && regionName) {
        regions.set(regionCode, { name: regionName, code: regionCode, type: "region" });
      }
      if (provinceCode && provinceName) {
        provinces.set(provinceCode, { 
          name: provinceName, 
          code: provinceCode, 
          type: "province",
          parent_code: regionCode 
        });
      }
      if (municipalityCode && municipalityName) {
        municipalities.set(municipalityCode, { 
          name: municipalityName, 
          code: municipalityCode, 
          type: "municipality",
          parent_code: provinceCode || regionCode
        });
      }
      if (barangayCode && barangayName) {
        barangays.push({
          name: barangayName,
          code: barangayCode,
          type: "barangay",
          parent_code: municipalityCode
        });
      }
    }

    const upsertAreas = async (areas: any[], typeLabel: string) => {
      console.log(`Importing ${areas.length} ${typeLabel}...`);
      const chunkSize = 500;
      for (let i = 0; i < areas.length; i += chunkSize) {
        const chunk = areas.slice(i, i + chunkSize);
        const ops = chunk.map(area => ({
          updateOne: {
            filter: { code: area.code },
            update: { $set: area },
            upsert: true
          }
        }));

        let retries = 3;
        while (retries > 0) {
          try {
            await Area.bulkWrite(ops);
            break;
          } catch (err) {
            console.error(`  Error in chunk ${i}, retries left: ${retries - 1}`);
            retries--;
            if (retries === 0) throw err;
            await new Promise(res => setTimeout(res, 2000));
          }
        }
        process.stdout.write(".");
      }
      console.log(`\n✅ ${typeLabel} import finished.`);
    };

    // 1. Regions
    await upsertAreas(Array.from(regions.values()), "regions");

    // Map codes to IDs for parent linking
    const areaMap = new Map();
    let allAreas = await Area.find({}, "code _id");
    allAreas.forEach(a => areaMap.set(a.code, a._id.toString()));

    // 2. Provinces
    const provinceList = Array.from(provinces.values()).map(p => ({
      ...p,
      parent_id: areaMap.get(p.parent_code)
    }));
    await upsertAreas(provinceList, "provinces");

    // Refresh map
    allAreas = await Area.find({ type: { $in: ["region", "province"] } }, "code _id");
    allAreas.forEach(a => areaMap.set(a.code, a._id.toString()));

    // 3. Municipalities
    const muniList = Array.from(municipalities.values()).map(m => ({
      ...m,
      parent_id: areaMap.get(m.parent_code)
    }));
    await upsertAreas(muniList, "municipalities");

    // Refresh map for municipalities
    allAreas = await Area.find({ type: "municipality" }, "code _id");
    allAreas.forEach(a => areaMap.set(a.code, a._id.toString()));

    // 4. Barangays
    const brgyList = barangays.map(b => ({
      ...b,
      parent_id: areaMap.get(b.parent_code)
    }));
    await upsertAreas(brgyList, "barangays");

    console.log("✅ Custom PSGC Import completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Import failed:", error);
    process.exit(1);
  }
}

importData();
