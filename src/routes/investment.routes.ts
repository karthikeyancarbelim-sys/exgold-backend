import express from "express";
import {
  getGoldBalance,
  getInvestmentRates,
  getInvestmentStatus,
  getMyGoldTransactions,
  sellGoldInvestment,
  startSipInvestment,
} from "../controllers/investment.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

router.get("/status", verifyFirebaseToken, getInvestmentStatus);
router.get("/rates", verifyFirebaseToken, getInvestmentRates);
router.get("/balance", verifyFirebaseToken, getGoldBalance);
router.get("/portfolio", verifyFirebaseToken, getGoldBalance);
router.get("/transactions", verifyFirebaseToken, getMyGoldTransactions);
// Digital gold is purchased only through the verified payment checkout.
router.post("/buy", verifyFirebaseToken, (_req, res) =>
  res.status(410).json({ message: "Use the paid checkout flow for digital gold" })
);
router.post("/sell", verifyFirebaseToken, sellGoldInvestment);
router.post("/sip", verifyFirebaseToken, startSipInvestment);
router.post("/withdraw", verifyFirebaseToken, (_req, res) =>
  res.status(501).json({
    message: "Gold redemption is not available until delivery settlement is enabled",
  })
);
router.post("/redeem", verifyFirebaseToken, (_req, res) =>
  res.status(501).json({
    message: "Gold redemption is not available until delivery settlement is enabled",
  })
);

export default router;
