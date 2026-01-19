const mongoose = require('mongoose');
// We need to define the schema since we might not be able to require the model easily in this env
const BeneficiarySchema = new mongoose.Schema({
  hhid: String,
  status: String,
  barangay: String,
  municipality: String,
  province: String,
  region: String
});
const RedemptionSchema = new mongoose.Schema({
  beneficiary_id: mongoose.Schema.Types.Mixed,
  hhid: String,
  frm_period: String,
  attendance: String
});

const Beneficiary = mongoose.model('Beneficiary', BeneficiarySchema);
const Redemption = mongoose.model('Redemption', RedemptionSchema);

mongoose.connect('mongodb://localhost:27017/ibms').then(async () => {
  try {
    const redemption_status = 'present';
    const frm_period = 'January 2026';
    
    const attendanceMatch = { $in: ["present", "redeemed", "Present", "Redeemed"] };
    const escapedPeriod = frm_period.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const periodMatch = { $regex: new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i") };
    const redemptionQuery = { frm_period: periodMatch, attendance: attendanceMatch };
    
    console.log('Redemption Query:', JSON.stringify(redemptionQuery));
    
    const redemptions = await Redemption.find(redemptionQuery).select("beneficiary_id hhid").lean();
    console.log('Found Redemptions:', redemptions.length);
    
    const matchedBenIds = new Set();
    const matchedHhids = new Set();
    
    redemptions.forEach(r => {
      if (r.beneficiary_id) matchedBenIds.add(r.beneficiary_id.toString());
      if (r.hhid) matchedHhids.add(r.hhid);
    });
    
    console.log('Matched Ben IDs count:', matchedBenIds.size);
    console.log('Matched HHIDs count:', matchedHhids.size);
    
    const benIdObjs = Array.from(matchedBenIds).filter(id => id.length === 24).map(id => new mongoose.Types.ObjectId(id));
    
    const filters = [];
    filters.push({
      $or: [
        { _id: { $in: benIdObjs } },
        { hhid: { $in: Array.from(matchedHhids).filter(h => !!h) } }
      ]
    });
    
    const query = { status: 'Active' };
    query.$and = filters;
    
    console.log('Beneficiary Query:', JSON.stringify(query));
    
    const beneficiaries = await Beneficiary.find(query);
    console.log('Found Beneficiaries:', beneficiaries.length);
    if (beneficiaries.length > 0) {
      console.log('Sample Beneficiary:', beneficiaries[0].hhid, beneficiaries[0].last_name);
    }

  } catch (err) {
    console.error(err);
  } finally {
    mongoose.connection.close();
  }
});
