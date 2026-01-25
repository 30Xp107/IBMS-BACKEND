
import mongoose from 'mongoose';
const BeneficiarySchema = new mongoose.Schema({ hhid: String });
const Beneficiary = mongoose.model('Beneficiary', BeneficiarySchema, 'beneficiaries');
async function run() {
    try {
        await mongoose.connect('mongodb+srv://Jhanbrent99:Jhanbrent99@lms.24upq.mongodb.net/IBMS?retryWrites=true&w=majority&appName=IBMS');
        const b = await Beneficiary.findById('695e2337f1645965947692ff');
        console.log('Beneficiary by ID:', JSON.stringify(b, null, 2));
        const b2 = await Beneficiary.findOne({ hhid: '0700005948276' });
        console.log('Beneficiary by HHID:', JSON.stringify(b2, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}
run();
