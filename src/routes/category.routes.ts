import express from "express";
import {
  createCategory,
  deleteCategory,
  getAllCategories,
  getJewelleryCategories,
  updateCategory,
} from "../controllers/category.controller";
import { verifyAdminJWT } from "../middleware/adminJwt";
import { verifyAdmin } from "../middleware/admin";
import { apiLimiter } from "../middleware/rateLimit.middleware";

const router = express.Router();

router.get("/", getJewelleryCategories);
router.get("/admin/all", apiLimiter, verifyAdminJWT, verifyAdmin, getAllCategories);
router.post("/admin", apiLimiter, verifyAdminJWT, verifyAdmin, createCategory);
router.put("/admin/:id", apiLimiter, verifyAdminJWT, verifyAdmin, updateCategory);
router.delete("/admin/:id", apiLimiter, verifyAdminJWT, verifyAdmin, deleteCategory);

export default router;
