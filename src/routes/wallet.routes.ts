import express from "express";
import {
  getWallet,
  getWalletHistory
} from "../controllers/wallet.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

/* GET WALLET BALANCE */
router.get("/", verifyFirebaseToken, getWallet);

/* WALLET TRANSACTION HISTORY */
router.get("/history", verifyFirebaseToken, getWalletHistory);

export default router;