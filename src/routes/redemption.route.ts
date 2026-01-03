import express from "express";
import {
  createRedemption,
  deleteRedemption,
  getRedemptions,
  updateRedemption,
  upsertRedemption,
} from "../controllers/redemption.controller";
import { isAuthenticated, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", isAuthenticated, getRedemptions);
router.post("/", isAuthenticated, createRedemption);
router.post("/upsert", isAuthenticated, upsertRedemption);
router.put("/:id", isAuthenticated, updateRedemption);
router.delete("/:id", isAuthenticated, authorizeRoles("admin"), deleteRedemption);

export default router;

