import express from "express";
import { getDashboardStats, getRedemptionDashboardStats, getNESDashboardStats } from "../controllers/dashboard.controller";
import { isAuthenticated } from "../middleware/auth";

const router = express.Router();

router.get("/stats", isAuthenticated, getDashboardStats);
router.get("/redemption-stats", isAuthenticated, getRedemptionDashboardStats);
router.get("/nes-stats", isAuthenticated, getNESDashboardStats);

export default router;

