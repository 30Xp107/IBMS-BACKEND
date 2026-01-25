
import mongoose from "mongoose";
import { Redemption } from "./src/models/redemption.model";
import { NES } from "./src/models/nes.model";
import dotenv from "dotenv";

dotenv.config();

async function checkAttendance() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('Connected to MongoDB');

  const period = "FRM 12 (DECEMBER 27, 2025 - JANUARY 31, 2026)"; 
  console.log(`Checking attendance for period: "${period}"`);

  const reds = await Redemption.find({ frm_period: period });
  const nes = await NES.find({ frm_period: period });

  console.log(`Redemption records: ${reds.length}`);
  const redAttendance: any = {};
  reds.forEach(r => {
    redAttendance[r.attendance] = (redAttendance[r.attendance] || 0) + 1;
  });
  console.log('Redemption attendance distribution:', redAttendance);

  console.log(`NES records: ${nes.length}`);
  const nesAttendance: any = {};
  nes.forEach(r => {
    nesAttendance[r.attendance] = (nesAttendance[r.attendance] || 0) + 1;
  });
  console.log('NES attendance distribution:', nesAttendance);

  await mongoose.disconnect();
}

checkAttendance();
