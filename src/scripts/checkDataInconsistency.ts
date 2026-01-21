import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Beneficiary } from '../models/beneficiary.model';

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function checkData() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI not found in .env');
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const provinces = await Beneficiary.distinct('province');
    console.log('Unique Provinces:', JSON.stringify(provinces, null, 2));

    const negrosVariations = provinces.filter(p => p?.toLowerCase().includes('negros oriental'));
    console.log('Negros Oriental variations found:', negrosVariations);

    const municipalities = await Beneficiary.distinct('municipality');
    console.log('Unique Municipalities (first 50):', JSON.stringify(municipalities.slice(0, 50), null, 2));

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error checking data:', err);
    process.exit(1);
  }
}

checkData();
