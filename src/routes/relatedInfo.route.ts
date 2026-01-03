import { Router } from "express";
import { assignInfo, deleteInfo, getRelatedInfo, updateInfo } from "../controllers/relatedInfo.controller";
import { isAuthenticated, authorizeRoles } from "../middleware/auth";

const relatedRouter = Router()
relatedRouter.post('/assign-info', isAuthenticated, authorizeRoles('admin'), assignInfo)
relatedRouter.get('/get-info', isAuthenticated, authorizeRoles('admin'), getRelatedInfo)
relatedRouter.put('/update-info/:id', isAuthenticated, authorizeRoles('admin'), updateInfo)
relatedRouter.delete('/delete-info/:id', isAuthenticated, authorizeRoles('admin'), deleteInfo)

export default relatedRouter


