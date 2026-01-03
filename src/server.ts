import dotenv from 'dotenv'
dotenv.config()
import http from 'http'
import { app } from './app'
import connectDB from './utils/db'

const PORT = process.env.PORT || 5000

const httpServer = http.createServer(app)

const start = async () => {
    await connectDB()
    httpServer.listen(PORT, () => console.log(`Server listening on ${PORT}`))
}

start()


