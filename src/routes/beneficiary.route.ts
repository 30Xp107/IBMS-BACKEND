import express from "express";
import {
  createBeneficiary,
  bulkCreateBeneficiaries,
  checkDuplicates,
  deleteBeneficiary,
  getBeneficiaries,
  updateBeneficiary,
} from "../controllers/beneficiary.controller";
import { isAuthenticated, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", isAuthenticated, getBeneficiaries);
router.post("/", isAuthenticated, authorizeRoles("admin"), createBeneficiary);
router.post("/bulk", isAuthenticated, authorizeRoles("admin"), bulkCreateBeneficiaries);
router.post("/check-duplicates", isAuthenticated, authorizeRoles("admin"), checkDuplicates);
router.put("/:id", isAuthenticated, authorizeRoles("admin"), updateBeneficiary);
router.delete("/:id", isAuthenticated, authorizeRoles("admin"), deleteBeneficiary);

export default router;

