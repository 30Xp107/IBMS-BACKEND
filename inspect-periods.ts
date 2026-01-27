
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

async function checkFrm1Case() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI not found');
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    if (!db) throw new Error('DB connection failed');

    console.log('--- Inspecting all unique frm_periods ---');
    
    const redemptionPeriods = await db.collection('redemptions').distinct('frm_period');
    console.log('Redemption Periods:', JSON.stringify(redemptionPeriods, null, 2));

    const nesPeriods = await db.collection('nes').distinct('frm_period');
    console.log('NES Periods:', JSON.stringify(nesPeriods, null, 2));

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkFrm1Case();
