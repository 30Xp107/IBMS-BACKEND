import { Router } from 'express'
import { register, login, logout, refreshToken, updateUser, getuser, getMe } from '../controllers/auth.controller'
import { isAuthenticated } from '../middleware/auth'

const authRoute = Router()
authRoute.post('/register', register)
authRoute.post('/login', login)
authRoute.post('/logout', logout) 
authRoute.get('/refresh', refreshToken)
authRoute.get('/me', isAuthenticated, getMe)
authRoute.put('/update-user/:id', isAuthenticated, updateUser)
authRoute.get('/get-users', isAuthenticated, getuser)

export default authRoute


