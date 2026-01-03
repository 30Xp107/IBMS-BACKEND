import express from "express";
import { getAuditLogs } from "../controllers/auditLog.controller";
import { isAuthenticated, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", isAuthenticated, authorizeRoles("admin"), getAuditLogs);

export default router;

