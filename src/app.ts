import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import authRoute from './routes/auth.route'
import performanceRoute from './routes/performance.route'
import relatedRoute from './routes/relatedInfo.route'
import dashboardRoute from './routes/dashboard.route'
import beneficiaryRoute from './routes/beneficiary.route'
import redemptionRoute from './routes/redemption.route'
import nesRoute from './routes/nes.route'
import areaRoute from './routes/area.route'
import userRoute from './routes/user.route'
import auditLogRoute from './routes/auditLog.route'
import systemConfigRoute from './routes/systemConfig.route'
import { errorHandler } from './middleware/error'

export const app = express()
app.use(helmet())
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean) as string[];

app.use(cors({ 
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    const isAllowed = allowedOrigins.some(allowed => origin === allowed) || 
                     (process.env.NODE_ENV !== 'production') ||
                     origin.endsWith('.vercel.app'); // Allow all vercel subdomains

    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}))
app.use(express.json({ limit: '300mb' }))
app.use(express.urlencoded({ limit: '300mb', extended: true }))
app.use(cookieParser())

app.use('/api/auth', authRoute)
app.use('/api/rate', performanceRoute)
app.use('/api/related', relatedRoute)
app.use('/api/dashboard', dashboardRoute)
app.use('/api/beneficiaries', beneficiaryRoute)
app.use('/api/redemptions', redemptionRoute)
app.use('/api/nes', nesRoute)
app.use('/api/areas', areaRoute)
app.use('/api/users', userRoute)
app.use('/api/audit-logs', auditLogRoute)
app.use('/api/system-configs', systemConfigRoute)

app.get('/test', (req, res) => res.json({ success: true }))

app.use(errorHandler)


