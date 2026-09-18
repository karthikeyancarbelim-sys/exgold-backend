import express from "express";
import {
  createWithdrawalRequest,
  getMyWithdrawalRequests,
  getPayoutCapabilities,
  getWithdrawalAccount,
  upsertWithdrawalAccount,
} from "../controllers/withdrawal.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

router.get("/capabilities", verifyFirebaseToken, getPayoutCapabilities);
router.get("/account", verifyFirebaseToken, getWithdrawalAccount);
router.put("/account", verifyFirebaseToken, upsertWithdrawalAccount);
router.get("/requests", verifyFirebaseToken, getMyWithdrawalRequests);
router.post("/requests", verifyFirebaseToken, createWithdrawalRequest);

export default router;
