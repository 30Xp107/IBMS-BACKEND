import mongoose from "mongoose";
import dotenv from "dotenv";
import { Area } from "../models/area.model";
import connectDB from "../utils/db";

dotenv.config();

const API_BASE = "https://psgc.gitlab.io/api";

async function fetchWithRetry(url: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`Retrying ${url}... (${i + 1}/${retries})`);
      await new Promise(res => setTimeout(res, 1000));
    }
  }
}

const seedPSGC = async () => {
  try {
    await connectDB();
    console.log("Connected to database...");

    // 1. Clear existing areas to avoid duplicates if necessary
    // await Area.deleteMany({});
    // console.log("Cleared existing areas.");

    // 2. Regions
    console.log("Fetching Regions...");
    const regions = await fetchWithRetry(`${API_BASE}/regions.json`);
    console.log(`Found ${regions.length} regions.`);

    for (const region of regions) {
      await Area.findOneAndUpdate(
        { code: region.code },
        { 
          name: region.name, 
          code: region.code, 
          type: "region" 
        },
        { upsert: true }
      );
    }
    console.log("Regions imported.");

    // 3. Provinces
    console.log("Fetching Provinces...");
    const provinces = await fetchWithRetry(`${API_BASE}/provinces.json`);
    console.log(`Found ${provinces.length} provinces.`);

    for (const province of provinces) {
      await Area.findOneAndUpdate(
        { code: province.code },
        { 
          name: province.name, 
          code: province.code, 
          type: "province",
          parent_code: province.regionCode
        },
        { upsert: true }
      );
    }
    console.log("Provinces imported.");

    // 4. Cities & Municipalities
    console.log("Fetching Cities and Municipalities...");
    const cities = await fetchWithRetry(`${API_BASE}/cities-municipalities.json`);
    console.log(`Found ${cities.length} cities/municipalities.`);

    for (const city of cities) {
      await Area.findOneAndUpdate(
        { code: city.code },
        { 
          name: city.name, 
          code: city.code, 
          type: "municipality",
          parent_code: city.provinceCode || city.regionCode // Some cities are direct under regions (e.g. NCR)
        },
        { upsert: true }
      );
    }
    console.log("Cities and Municipalities imported.");

    // 5. Barangays (This is the largest part)
    console.log("Fetching Barangays... This might take a while.");
    const barangays = await fetchWithRetry(`${API_BASE}/barangays.json`);
    console.log(`Found ${barangays.length} barangays.`);

    // Import barangays in chunks to avoid memory issues and database timeouts
    const chunkSize = 500;
    for (let i = 0; i < barangays.length; i += chunkSize) {
      const chunk = barangays.slice(i, i + chunkSize);
      const ops = chunk.map((b: any) => ({
        updateOne: {
          filter: { code: b.code },
          update: { 
            name: b.name, 
            code: b.code, 
            type: "barangay",
            parent_code: b.cityMunicipalityCode || b.municipalityCode || b.provinceCode || b.regionCode
          },
          upsert: true
        }
      }));
      
      let retryCount = 0;
      while (retryCount < 3) {
        try {
          await Area.bulkWrite(ops, { ordered: false });
          break;
        } catch (e) {
          retryCount++;
          console.log(`  Retry ${retryCount}/3 for chunk starting at ${i}...`);
          await new Promise(res => setTimeout(res, 2000));
        }
      }
      
      console.log(`  Imported ${Math.min(i + chunkSize, barangays.length)} / ${barangays.length} barangays...`);
      // Add a small delay to prevent ECONNRESET
      await new Promise(res => setTimeout(res, 100));
    }
    console.log("Barangays imported.");

    // 6. Link Parent IDs
    console.log("Linking parents by ID...");
    const allAreas = await Area.find({ parent_code: { $exists: true, $ne: "" } });
    console.log(`Processing links for ${allAreas.length} areas...`);
    
    // Create a map for faster lookups
    const areaMap = new Map();
    const allAreasForMap = await Area.find({}, { _id: 1, code: 1 });
    allAreasForMap.forEach(a => areaMap.set(a.code, a._id));

    const linkOps = [];
    for (const area of allAreas) {
      const parentId = areaMap.get(area.parent_code);
      if (parentId) {
        linkOps.push({
          updateOne: {
            filter: { _id: area._id },
            update: { parent_id: parentId }
          }
        });
      }

      if (linkOps.length >= 1000) {
        await Area.bulkWrite(linkOps);
        linkOps.length = 0;
      }
    }
    
    if (linkOps.length > 0) {
      await Area.bulkWrite(linkOps);
    }
    console.log("Parent linking completed!");

    console.log("PSGC Seed completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Error seeding PSGC:", error);
    process.exit(1);
  }
};

seedPSGC();
