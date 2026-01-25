
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

const RedemptionSchema = new mongoose.Schema({
    frm_period: String,
    attendance: String,
    beneficiary_id: mongoose.Schema.Types.ObjectId,
    hhid: String
}, { collection: 'redemptions' });

const Redemption = mongoose.model('Redemption', RedemptionSchema);

async function checkPeriods() {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not defined in .env');
        }
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const sample = await Redemption.findOne();
        console.log('Sample Redemption:', JSON.stringify(sample, null, 2));

        const distinctPeriods = await Redemption.distinct('frm_period');
        console.log('Distinct FRM Periods in Redemptions:', distinctPeriods);

        const count = await Redemption.countDocuments();
        console.log('Total Redemptions:', count);

        if (distinctPeriods.length > 0) {
            const period = distinctPeriods[0];
            const escapedPeriod = period.trim().replace(/[.*+?^${}()|[\\\]]/g, '\\$&');
            const regex = new RegExp(`^\\s*${escapedPeriod}\\s*$`, "i");
            const matchCount = await Redemption.countDocuments({ frm_period: { $regex: regex } });
            console.log(`Testing regex for period "${period}": ${matchCount} matches`);
        }

        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
    }
}

checkPeriods();
