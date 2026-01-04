import mongoose from "mongoose"
import dotenv from "dotenv"
dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI || ''

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000, // 10 seconds
            socketTimeoutMS: 45000, // 45 seconds
            family: 4 // Use IPv4, skip trying IPv6
        })
        console.log(`MongoDB connected: ${conn.connection.host}`)
    } catch (error) {
        console.log('MongoDB connection error:', error)
        // Don't exit process in development, let the error handler catch it
        if (process.env.NODE_ENV === 'production') {
            process.exit(1)
        }
    }
}

export default connectDB


