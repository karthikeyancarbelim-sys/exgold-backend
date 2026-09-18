import express from "express";
import { startKyc, getMyKyc, kycaidCallback, nerotixCallback, createKycSession, verifyPan } from "../controllers/kyc.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

router.post("/create-session", verifyFirebaseToken, createKycSession);
router.post("/pan/verify", verifyFirebaseToken, verifyPan);
router.post("/start", verifyFirebaseToken, startKyc);
router.post("/start/:step", verifyFirebaseToken, startKyc);
router.get("/me", verifyFirebaseToken, getMyKyc);
router.post("/kycaid/callback", kycaidCallback);
router.post("/nerotix/callback", nerotixCallback);

export default router;
