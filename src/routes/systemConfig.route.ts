import express from "express";
import { getConfig, updateConfig } from "../controllers/systemConfig.controller";
import { isAuthenticated, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/:key", isAuthenticated, getConfig);
router.put("/:key", isAuthenticated, authorizeRoles("admin"), updateConfig);

export default router;
