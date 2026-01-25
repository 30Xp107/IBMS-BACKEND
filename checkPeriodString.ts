
import mongoose from 'mongoose';
const RedemptionSchema = new mongoose.Schema({ frm_period: String });
const Redemption = mongoose.model('Redemption', RedemptionSchema, 'redemptions');
async function run() {
    try {
        await mongoose.connect('mongodb+srv://Jhanbrent99:Jhanbrent99@lms.24upq.mongodb.net/IBMS?retryWrites=true&w=majority&appName=IBMS');
        const r = await Redemption.findOne({ frm_period: /FRM 12/ });
        if (r && r.frm_period) {
            const period = r.frm_period;
            console.log('Period:', JSON.stringify(period));
            console.log('Length:', period.length);
            for (let i = 0; i < period.length; i++) {
                console.log(`Char ${i}: ${period[i]} (${period.charCodeAt(i)})`);
            }
        } else {
            console.log('No record found with FRM 12');
        }
    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}
run();
