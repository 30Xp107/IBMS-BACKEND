import mongoose from "mongoose";
import dotenv from "dotenv";
import userModel from "../models/user.model";
import connectDB from "../utils/db";

dotenv.config();

const updateUserStatus = async () => {
  try {
    await connectDB();

    // Find all users without status field
    const usersWithoutStatus = await userModel.find({
      $or: [
        { status: { $exists: false } },
        { status: null },
        { status: undefined }
      ]
    });

    console.log(`Found ${usersWithoutStatus.length} user(s) without status field`);

    // Update each user
    for (const user of usersWithoutStatus) {
      // Set status based on role: admins should be approved, others pending
      const newStatus = user.role === "admin" ? "approved" : "pending";
      
      // Also ensure assigned_areas exists
      if (!user.assigned_areas) {
        user.assigned_areas = [];
      }

      await userModel.findByIdAndUpdate(user._id, {
        $set: {
          status: newStatus,
          assigned_areas: user.assigned_areas || []
        }
      });

      console.log(`✅ Updated user ${user.email}: status = ${newStatus}`);
    }

    console.log("\n✅ All users updated successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error updating users:", error);
    process.exit(1);
  }
};

updateUserStatus();

