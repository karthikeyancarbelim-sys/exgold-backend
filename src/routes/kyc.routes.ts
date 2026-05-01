import express from "express";
import { startKyc, getMyKyc } from "../controllers/kyc.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

router.post("/start", verifyFirebaseToken, startKyc);
router.get("/me", verifyFirebaseToken, getMyKyc);

export default router;