import mongoose, {Document, Model, Schema, Types} from 'mongoose'

export interface IRelatedInfo extends Document{
    userId: Types.ObjectId
    status: string
    program: string
    division: string
    assign: Types.ObjectId
    _doc?: any
}

const relatedInfoSchema = new Schema<IRelatedInfo>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        required: true
    },
    program: {
        type: String,
        required: true
    },
    division: {
        type: String,
        required: true
    },
    assign: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
})

const relatedModel: Model<IRelatedInfo> = mongoose.model('RelatedInfo', relatedInfoSchema)

export default relatedModel


