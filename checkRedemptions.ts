
import mongoose from 'mongoose';
const RedemptionSchema = new mongoose.Schema({ beneficiary_id: mongoose.Schema.Types.ObjectId, hhid: String, frm_period: String, attendance: String });
const Redemption = mongoose.model('Redemption', RedemptionSchema, 'redemptions');
async function run() {
    try {
        await mongoose.connect('mongodb+srv://Jhanbrent99:Jhanbrent99@lms.24upq.mongodb.net/IBMS?retryWrites=true&w=majority&appName=IBMS');
        const count = await Redemption.countDocuments();
        console.log('Total redemptions:', count);
        const sample = await Redemption.findOne();
        console.log('Sample redemption:', JSON.stringify(sample, null, 2));
        const periods = await Redemption.distinct('frm_period');
        console.log('Periods:', periods);
    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}
run();
