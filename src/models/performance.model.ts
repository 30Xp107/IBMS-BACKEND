import mongoose, {Document, Model, Schema} from "mongoose";

export interface IPerformance extends Document {
    userId: string
    rating: number
    comment: string
    ratee: mongoose.Types.ObjectId | string
    createdAt: Date
}

const performanceSchema = new Schema<IPerformance>({
    userId: {
        type: String,
        required: true,
        ref: 'User'
    },
    rating: {
        type: Number,
        required: true,
        default: 0
    },
    comment: {
        type: String,
        required: true,
    },
    ratee: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true })

const performanceModel: Model<IPerformance> = mongoose.model('Performance', performanceSchema)

export default performanceModel


