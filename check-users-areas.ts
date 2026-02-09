import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

async function checkUsers() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI not found');
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    if (!db) throw new Error('DB connection failed');

    console.log('--- Inspecting Users and Assigned Areas ---');
    
    const users = await db.collection('users').find({}).toArray();
    
    for (const user of users) {
      console.log(`User: ${user.name} (${user.email})`);
      console.log(`Role: ${user.role}, Status: ${user.status}`);
      console.log(`Assigned Areas:`, JSON.stringify(user.assigned_areas, null, 2));
      
      if (user.assigned_areas && user.assigned_areas.length > 0) {
        const areaIds = user.assigned_areas.map((id: any) => {
          try {
            return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
          } catch (e) {
            return id;
          }
        });
        
        const areas = await db.collection('areas').find({
          _id: { $in: areaIds }
        }).toArray();
        
        console.log(`Found ${areas.length} areas in DB:`);
        areas.forEach(a => console.log(` - ${a.name} (${a.type})`));
      }
      console.log('-----------------------------------');
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUsers();
