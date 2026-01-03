import express from "express";
import {
  createNES,
  deleteNES,
  getNESRecords,
  updateNES,
  upsertNES,
} from "../controllers/nes.controller";
import { isAuthenticated, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", isAuthenticated, getNESRecords);
router.post("/", isAuthenticated, createNES);
router.post("/upsert", isAuthenticated, upsertNES);
router.put("/:id", isAuthenticated, updateNES);
router.delete("/:id", isAuthenticated, authorizeRoles("admin"), deleteNES);

export default router;

