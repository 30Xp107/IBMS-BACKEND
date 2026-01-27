
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

async function checkFrm1() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI not found');
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    if (!db) throw new Error('DB connection failed');

    console.log('--- Checking for "FRM 1" in various collections ---');

    // 1. Check redemptions
    const redemptionsCount = await db.collection('redemptions').countDocuments({
      $or: [
        { frm_period: "FRM 1" },
        { frm_period: { $regex: /^FRM 1$/i } },
        { frm_period: { $regex: /FRM 1/i } }
      ]
    });
    console.log(`Redemptions with "FRM 1": ${redemptionsCount}`);

    // 2. Check nes
    const nesCount = await db.collection('nes').countDocuments({
      $or: [
        { frm_period: "FRM 1" },
        { frm_period: { $regex: /^FRM 1$/i } },
        { frm_period: { $regex: /FRM 1/i } }
      ]
    });
    console.log(`NES records with "FRM 1": ${nesCount}`);

    // 3. Check system_configs (where schedules might be stored)
    const configs = await db.collection('system_configs').find({
      name: "frm_schedules"
    }).toArray();
    
    console.log('FRM Schedules in system_configs:', JSON.stringify(configs, null, 2));

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkFrm1();
