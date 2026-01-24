import mongoose from "mongoose";
import dotenv from "dotenv";
import { Area } from "../models/area.model";
import connectDB from "../utils/database";

dotenv.config();

const verifyImport = async () => {
  try {
    await connectDB();
    console.log("Connected to database...");
    
    // Log the current DB name to be absolutely sure
    console.log("Current Database:", mongoose.connection.db?.databaseName);

    const counts = await Area.aggregate([
      { $group: { _id: "$type", count: { $sum: 1 } } }
    ]);

    console.log("Area counts by type:");
    counts.forEach(c => console.log(`- ${c._id}: ${c.count}`));

    const total = await Area.countDocuments();
    console.log("Total Areas:", total);

    process.exit(0);
  } catch (error) {
    console.error("Error verifying import:", error);
    process.exit(1);
  }
};

verifyImport();
