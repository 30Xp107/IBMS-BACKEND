import express from "express";
import { createArea, deleteArea, getAreas } from "../controllers/area.controller";
import { isAuthenticated, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", isAuthenticated, getAreas);
router.post("/", isAuthenticated, authorizeRoles("admin"), createArea);
router.delete("/:id", isAuthenticated, authorizeRoles("admin"), deleteArea);

export default router;

