import express from "express";
import {
  createBeneficiary,
  deleteBeneficiary,
  getBeneficiaries,
  updateBeneficiary,
} from "../controllers/beneficiary.controller";
import { isAuthenticated, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", isAuthenticated, getBeneficiaries);
router.post("/", isAuthenticated, authorizeRoles("admin"), createBeneficiary);
router.put("/:id", isAuthenticated, authorizeRoles("admin"), updateBeneficiary);
router.delete("/:id", isAuthenticated, authorizeRoles("admin"), deleteBeneficiary);

export default router;

