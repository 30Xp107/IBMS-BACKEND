
import mongoose from 'mongoose';
const RedemptionSchema = new mongoose.Schema({ beneficiary_id: String, hhid: String, frm_period: String, attendance: String });
const Redemption = mongoose.model('Redemption', RedemptionSchema, 'redemptions');

const escapeRegex = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

async function run() {
    try {
        await mongoose.connect('mongodb+srv://Jhanbrent99:Jhanbrent99@lms.24upq.mongodb.net/IBMS?retryWrites=true&w=majority&appName=IBMS');
        
        const frm_period = "FRM 12 (DECEMBER 27, 2025 - JANUARY 31, 2026)";
        const redemption_status: string = "redeemed";
        
        let attendanceMatch: any;
        if (redemption_status === "present" || redemption_status === "redeemed") {
            attendanceMatch = { $in: ["present", "redeemed", "Present", "Redeemed"] };
        }
        
        const redemptionQuery: any = {};
        if (frm_period) {
            const escapedPeriod = escapeRegex(frm_period.trim());
            redemptionQuery.frm_period = { $regex: new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i") };
        }
        if (attendanceMatch) {
            redemptionQuery.attendance = attendanceMatch;
        }
        
        console.log('Query:', JSON.stringify(redemptionQuery, null, 2));
        
        const redemptions = await Redemption.find(redemptionQuery).select("beneficiary_id hhid").lean();
        console.log('Count:', redemptions.length);
        if (redemptions.length > 0) {
            console.log('Sample:', redemptions[0]);
        }
        
    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}
run();
