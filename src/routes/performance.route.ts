import { Router } from "express";
import { editRate, getRate, rateEmployee } from "../controllers/performance.controller";
import { authorizeRoles, isAuthenticated } from "../middleware/auth";

const rateRoute = Router()
rateRoute.post('/rate-employee', isAuthenticated, authorizeRoles('admin'), rateEmployee)
rateRoute.get('/get-rate', isAuthenticated, getRate)
rateRoute.put('/update-rate/:id', isAuthenticated, authorizeRoles('admin'), editRate)

export default rateRoute


