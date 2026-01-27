
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

async function deleteSpecificFrm1() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI not found');
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    if (!db) throw new Error('DB connection failed');

    const exactPeriod = "FRM 1 (JANUARY 19, 2026 - JANUARY 31, 2026";

    console.log(`--- Deleting exactly: "${exactPeriod}" ---`);

    // 1. Delete from redemptions
    const redemptionResult = await db.collection('redemptions').deleteMany({
      frm_period: exactPeriod
    });
    console.log(`Deleted ${redemptionResult.deletedCount} records from redemptions.`);

    // 2. Delete from nes
    const nesResult = await db.collection('nes').deleteMany({
      frm_period: exactPeriod
    });
    console.log(`Deleted ${nesResult.deletedCount} records from nes.`);

    // 3. Check system_configs
    const configs = await db.collection('system_configs').find({
      key: "frm_schedules"
    }).toArray();

    for (const config of configs) {
      if (Array.isArray(config.value)) {
        const newValue = config.value.filter((s: any) => s.name !== exactPeriod);
        if (newValue.length !== config.value.length) {
          await db.collection('system_configs').updateOne(
            { _id: config._id },
            { $set: { value: newValue } }
          );
          console.log(`Removed from system_configs schedules.`);
        }
      }
    }

    await mongoose.disconnect();
    console.log('--- Cleanup complete ---');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

deleteSpecificFrm1();
