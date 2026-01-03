import mongoose from "mongoose";
import dotenv from "dotenv";
import userModel from "../models/user.model";
import connectDB from "../utils/db";

dotenv.config();

const createAdmin = async () => {
  try {
    await connectDB();

    // Check if admin already exists
    const existing = await userModel.findOne({ role: "admin" });
    if (existing) {
      console.log("❌ Admin already exists!");
      console.log(`Email: ${existing.email}`);
      process.exit(0);
    }

    // Create admin user
    const admin = await userModel.create({
      name: "System Admin",
      email: "admin@wgp.gov.ph",
      password: "admin123",
      role: "admin",
      status: "approved",
      assigned_areas: [],
    });

    console.log("✅ Admin account created successfully!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Email:    admin@wgp.gov.ph");
    console.log("Password: admin123");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n⚠️  Please change the password after first login!");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error creating admin:", error);
    process.exit(1);
  }
};

createAdmin();

