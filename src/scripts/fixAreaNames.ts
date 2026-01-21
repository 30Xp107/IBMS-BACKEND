import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { normalizeArea } from '../utils/normalization';

// Load env from the root or server directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI not found in .env');
  process.exit(1);
}

async function fixData() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI!);
    console.log('Connected!');

    const db = mongoose.connection.db;
    if (!db) {
      console.error('Database connection not established');
      process.exit(1);
    }

    // 1. Fix Beneficiaries
    console.log('Fetching beneficiaries...');
    const beneficiaries = await db.collection('beneficiaries').find({}).toArray();
    console.log(`Found ${beneficiaries.length} beneficiaries.`);

    let bUpdates = 0;
    for (const b of beneficiaries) {
      const updates: any = {};
      const fields = ['region', 'province', 'municipality', 'barangay'];
      
      for (const field of fields) {
        if (b[field]) {
          const normalized = normalizeArea(b[field]);
          if (normalized !== b[field]) {
            updates[field] = normalized;
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await db.collection('beneficiaries').updateOne(
          { _id: b._id },
          { $set: updates }
        );
        bUpdates++;
      }
    }
    console.log(`Updated ${bUpdates} beneficiaries.`);

    // 2. Fix Areas
    console.log('Fetching areas...');
    const areas = await db.collection('areas').find({}).toArray();
    console.log(`Found ${areas.length} areas.`);

    let aUpdates = 0;
    for (const a of areas) {
      if (a.name) {
        const normalized = normalizeArea(a.name);
        if (normalized !== a.name) {
          await db.collection('areas').updateOne(
            { _id: a._id },
            { $set: { name: normalized } }
          );
          aUpdates++;
        }
      }
    }
    console.log(`Updated ${aUpdates} areas.`);

    console.log('Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixData();
