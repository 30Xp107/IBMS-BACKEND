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
import { errorHandler } from './middleware/error'

export const app = express()
app.use(helmet())
app.use(cors({ origin: true, credentials: true }))
app.use(express.json())
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

app.get('/test', (req, res) => res.json({ success: true }))

app.use(errorHandler)


