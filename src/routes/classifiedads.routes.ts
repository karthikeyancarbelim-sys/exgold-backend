// ===============================
// classifiedads.routes.ts
// ===============================
import express from "express";
import {
  createAd,
  getAds,
  getMyAds,
  deleteAd,
  updateAd,
  getAdById,
  getCategories,
  updateAdStatus,
  activateFeaturedAd
} from "../controllers/classifiedads.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

/* USER */
router.get("/my", verifyFirebaseToken, getMyAds);
router.post("/", verifyFirebaseToken, createAd);
router.put("/:id", verifyFirebaseToken, updateAd);
router.patch("/:id", verifyFirebaseToken, updateAd);
router.patch("/:id/status", verifyFirebaseToken, updateAdStatus);
router.post("/:id/feature", verifyFirebaseToken, activateFeaturedAd);
router.delete("/:id", verifyFirebaseToken, deleteAd);

/* PUBLIC */
router.get("/categories", getCategories);
router.get("/", getAds);
router.get("/:id", getAdById);

export default router;
