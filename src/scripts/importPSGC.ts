import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { Area } from "../models/area.model";
import connectDB from "../utils/db";

dotenv.config();

/**
 * Script to import PSGC (Philippine Standard Geographic Code) data from a CSV file.
 * The CSV should have columns for Code, Name, and Geographic Level.
 */
const importPSGC = async () => {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Please provide the path to the PSGC CSV file.");
    console.log("Usage: ts-node src/scripts/importPSGC.ts <path-to-csv>");
    process.exit(1);
  }

  try {
    await connectDB();
    console.log("Connected to database...");

    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    
    if (!fs.existsSync(absolutePath)) {
      console.error(`File not found: ${absolutePath}`);
      process.exit(1);
    }

    const data = fs.readFileSync(absolutePath, "utf8");
    const lines = data.split(/\r?\n/).filter(line => line.trim() !== "");
    
    // Attempt to detect columns from header
    const header = lines[0].toLowerCase();
    const columns = header.split(",");
    const codeIdx = columns.findIndex(c => c.includes("code"));
    const nameIdx = columns.findIndex(c => c.includes("name") || c.includes("description"));
    const levelIdx = columns.findIndex(c => c.includes("level") || c.includes("geographic"));

    if (codeIdx === -1 || nameIdx === -1 || levelIdx === -1) {
      console.error("CSV must contain 'Code', 'Name', and 'Level' columns.");
      console.log("Detected columns:", columns);
      process.exit(1);
    }

    console.log("Starting import...");
    let importedCount = 0;
    let skippedCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Handle quoted values in CSV
      const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      
      if (parts.length <= Math.max(codeIdx, nameIdx, levelIdx)) continue;

      const code = parts[codeIdx].trim().replace(/"/g, '');
      const name = parts[nameIdx].trim().replace(/"/g, '');
      const levelStr = parts[levelIdx].trim().replace(/"/g, '').toLowerCase();

      let type: "region" | "province" | "municipality" | "barangay";
      if (levelStr.includes("reg")) type = "region";
      else if (levelStr.includes("prov")) type = "province";
      else if (levelStr.includes("city") || levelStr.includes("mun")) type = "municipality";
      else if (levelStr.includes("bgy") || levelStr.includes("brgy")) type = "barangay";
      else {
        skippedCount++;
        continue;
      }

      // PSGC Code logic for parents (Standard 10-digit PSGC)
      let parentCode = "";
      if (type === "province") {
        parentCode = code.substring(0, 2) + "00000000".substring(0, code.length - 2);
      } else if (type === "municipality") {
        parentCode = code.substring(0, 5) + "00000000".substring(0, code.length - 5);
      } else if (type === "barangay") {
        parentCode = code.substring(0, 7) + "00000000".substring(0, code.length - 7);
      }

      // If the parent code is the same as the current code (happens at top level), clear it
      if (parentCode === code) parentCode = "";

      try {
        await Area.findOneAndUpdate(
          { code },
          { name, code, type, parent_code: parentCode || undefined },
          { upsert: true, new: true }
        );
        importedCount++;
        if (importedCount % 500 === 0) console.log(`Imported ${importedCount} records...`);
      } catch (err) {
        console.error(`Error importing ${name} (${code}):`, err);
        skippedCount++;
      }
    }

    console.log(`Imported ${importedCount} records. Now linking parents...`);

    // Second pass: Link parent_id using parent_code
    const areasWithParent = await Area.find({ parent_code: { $exists: true, $ne: "" } });
    let linkedCount = 0;

    for (const area of areasWithParent) {
      const parent = await Area.findOne({ code: area.parent_code });
      if (parent) {
        area.parent_id = parent._id as any;
        await area.save();
        linkedCount++;
        if (linkedCount % 500 === 0) console.log(`Linked ${linkedCount} parents...`);
      }
    }

    console.log(`✅ Success!`);
    console.log(`- Imported/Updated: ${importedCount}`);
    console.log(`- Linked Parents: ${linkedCount}`);
    console.log(`- Skipped: ${skippedCount}`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
};

importPSGC();
