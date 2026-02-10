import express from "express";
import {
  createBeneficiary,
  bulkCreateBeneficiaries,
  checkDuplicates,
  deleteBeneficiary,
  getBeneficiaries,
  getExportData,
  normalizeAllAreaNames,
  updateBeneficiary,
  bulkDeleteBeneficiaries,
  getAvailableFilters,
  recalculateAllStatuses,
} from "../controllers/beneficiary.controller";
import { isAuthenticated, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", isAuthenticated, getBeneficiaries);
router.get("/export", isAuthenticated, getExportData);
router.post("/maintenance/normalize-areas", isAuthenticated, authorizeRoles("admin"), normalizeAllAreaNames);
router.post("/maintenance/recalculate-status", isAuthenticated, authorizeRoles("admin"), recalculateAllStatuses);
router.get("/filters", isAuthenticated, getAvailableFilters);
router.post("/", isAuthenticated, authorizeRoles("admin"), createBeneficiary);
router.post("/bulk", isAuthenticated, authorizeRoles("admin"), bulkCreateBeneficiaries);
router.post("/check-duplicates", isAuthenticated, authorizeRoles("admin"), checkDuplicates);
router.put("/:id", isAuthenticated, updateBeneficiary);
router.delete("/:id", isAuthenticated, authorizeRoles("admin"), deleteBeneficiary);
router.post("/bulk-delete", isAuthenticated, authorizeRoles("admin"), bulkDeleteBeneficiaries);

export default router;

