import mongoose, { Document, Schema } from 'mongoose'
import bcrypt from 'bcryptjs'
import { Model } from 'mongoose'


export interface IUser extends Document {
    name: string
    email: string
    password: string
    role: 'user' | 'admin'
    status?: 'pending' | 'approved' | 'rejected'
    assigned_areas?: string[]
    _doc?: any
    comparePassword: (candidatee: string) => Promise<boolean>
    createdAt: Date;
    updatedAt: Date;
}

const userSchema = new Schema<IUser>({
    name: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
    },
    password: {
        type: String,
        required: true,
        select: false
    },
    role: {
        type: String,
        default: 'user'
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    assigned_areas: {
        type: [String],
        default: []
    }
}, {timestamps: true} )

userSchema.pre('save', async function(next) {
    const user = this as IUser
    if(!user.isModified('password')) return next()
    const salt = await bcrypt.genSalt(10)
    user.password = await bcrypt.hash(user.password, salt)
})

userSchema.methods.comparePassword = async function (candidate: string) {
    const user = this as IUser
    return bcrypt.compare(candidate, user.password)
}

const userModel: Model<IUser> = mongoose.model('User', userSchema)

export default userModel


