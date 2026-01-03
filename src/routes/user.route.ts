import express from "express";
import { approveUser, deleteUser, getuser } from "../controllers/auth.controller";
import { isAuthenticated, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", isAuthenticated, authorizeRoles("admin"), getuser);
router.put("/:id/approve", isAuthenticated, authorizeRoles("admin"), approveUser);
router.delete("/:id", isAuthenticated, authorizeRoles("admin"), deleteUser);

export default router;

