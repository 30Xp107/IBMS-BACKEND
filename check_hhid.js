
const mongoose = require('mongoose');
const URI = "mongodb+srv://Jhanbrent99:Jhanbrent99@lms.24upq.mongodb.net/IBMS?retryWrites=true&w=majority&appName=IBMS";

async function check() {
  await mongoose.connect(URI);
  const ben = await mongoose.connection.db.collection('beneficiaries').findOne({ hhid: { $exists: true } });
  console.log('HHID type:', typeof ben.hhid, JSON.stringify(ben.hhid));
  const countEmpty = await mongoose.connection.db.collection('beneficiaries').countDocuments({ hhid: "" });
  console.log('Count HHID empty:', countEmpty);
  const countNull = await mongoose.connection.db.collection('beneficiaries').countDocuments({ hhid: null });
  console.log('Count HHID null:', countNull);
  const countMissing = await mongoose.connection.db.collection('beneficiaries').countDocuments({ hhid: { $exists: false } });
  console.log('Count HHID missing:', countMissing);
  const countZeroStr = await mongoose.connection.db.collection('beneficiaries').countDocuments({ hhid: "0" });
  console.log('Count HHID "0":', countZeroStr);
  const countZeroNum = await mongoose.connection.db.collection('beneficiaries').countDocuments({ hhid: 0 });
  console.log('Count HHID 0 (num):', countZeroNum);
  console.log('--- Redemptions ---');
  const countRedZero = await mongoose.connection.db.collection('redemptions').countDocuments({ hhid: "0" });
  console.log('Redemptions with HHID "0":', countRedZero);
  const countRedEmpty = await mongoose.connection.db.collection('redemptions').countDocuments({ hhid: "" });
  console.log('Redemptions with HHID "":', countRedEmpty);
  const countRedNull = await mongoose.connection.db.collection('redemptions').countDocuments({ hhid: null });
  console.log('Redemptions with HHID null:', countRedNull);
  const sampleRed = await mongoose.connection.db.collection('redemptions').find({ hhid: "0" }).limit(1).toArray();
  console.log('Sample Redemption with HHID "0":', sampleRed);
  await mongoose.connection.close();
}

check().catch(console.error);
