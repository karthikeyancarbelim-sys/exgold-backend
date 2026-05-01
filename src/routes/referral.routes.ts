// ===============================
// referral.routes.ts
// ===============================
import express from "express";
import {
  generateReferralCode,
  applyReferral
} from "../controllers/referral.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

/* GENERATE CODE */
router.post("/generate", verifyFirebaseToken, generateReferralCode);

/* APPLY REFERRAL */
router.post("/apply", verifyFirebaseToken, applyReferral);

export default router;