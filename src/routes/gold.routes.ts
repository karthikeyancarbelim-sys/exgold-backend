import express from "express";
import {
  getGoldRates,
  updateGoldRates
} from "../controllers/gold.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

// Public
router.get("/rates", getGoldRates);

// Admin (protected)
router.post("/update-rate", verifyFirebaseToken, updateGoldRates);

export default router;