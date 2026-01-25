
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

async function checkConfig() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database connection failed");
  const config = await db.collection('systemconfigs').findOne({ key: 'frm_schedules' });
  console.log('FRM Schedules:', JSON.stringify(config, null, 2));
  await mongoose.disconnect();
}

checkConfig();
