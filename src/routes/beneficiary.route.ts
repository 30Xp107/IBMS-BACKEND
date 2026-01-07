import express from "express";
import {
  createBeneficiary,
  bulkCreateBeneficiaries,
  checkDuplicates,
  deleteBeneficiary,
  getBeneficiaries,
  updateBeneficiary,
  bulkDeleteBeneficiaries,
} from "../controllers/beneficiary.controller";
import { isAuthenticated, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", isAuthenticated, getBeneficiaries);
router.post("/", isAuthenticated, authorizeRoles("admin"), createBeneficiary);
router.post("/bulk", isAuthenticated, authorizeRoles("admin"), bulkCreateBeneficiaries);
router.post("/check-duplicates", isAuthenticated, authorizeRoles("admin"), checkDuplicates);
router.put("/:id", isAuthenticated, updateBeneficiary);
router.delete("/:id", isAuthenticated, authorizeRoles("admin"), deleteBeneficiary);
router.post("/bulk-delete", isAuthenticated, authorizeRoles("admin"), bulkDeleteBeneficiaries);

export default router;

