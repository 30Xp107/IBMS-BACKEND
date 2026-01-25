
import mongoose from "mongoose";
import { Redemption } from "./src/models/redemption.model";
import { NES } from "./src/models/nes.model";
import dotenv from "dotenv";

dotenv.config();

async function checkPeriods() {
  await mongoose.connect(process.env.MONGODB_URI!);
  
  const redPeriods = await Redemption.distinct("frm_period");
  console.log('Redemption periods:', redPeriods);

  const nesPeriods = await NES.distinct("frm_period");
  console.log('NES periods:', nesPeriods);

  await mongoose.disconnect();
}

checkPeriods();
