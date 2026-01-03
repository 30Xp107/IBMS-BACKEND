import mongoose from "mongoose"
import dotenv from "dotenv"
dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI || ''

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(MONGODB_URI)
        console.log(`MongoDB connecteed: ${conn.connection.host}`)
    } catch (error) {
        console.log('MongoDB connection error', error)
        process.exit(1)
    }
}

export default connectDB


