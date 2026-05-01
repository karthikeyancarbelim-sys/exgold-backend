import express from "express";
import {
  getAllUsers,
  getAllTransactions,
  updateMargin,
  adjustWallet,
  getAdminStats,
  blockUser,
  getAllAdsAdmin,
  approveAd,
  getAllKyc,
  approveKyc,
  rejectKyc
} from "../controllers/admin.controller";

import { adminLogin } from "../controllers/admin.auth.controller";
import { verifyAdminJWT } from "../middleware/adminJwt";
import { verifyAdmin } from "../middleware/admin";

const router = express.Router();

/* LOGIN */
router.post("/login", adminLogin);

/* USERS */
router.get("/users", verifyAdminJWT, verifyAdmin, getAllUsers);
router.put("/users/block/:id", verifyAdminJWT, verifyAdmin, blockUser);

/* ADS */
router.get("/ads", verifyAdminJWT, verifyAdmin, getAllAdsAdmin);
router.put("/ads/approve/:id", verifyAdminJWT, verifyAdmin, approveAd);

/* KYC */
router.get("/kyc", verifyAdminJWT, verifyAdmin, getAllKyc);
router.put("/kyc/approve/:id", verifyAdminJWT, verifyAdmin, approveKyc);
router.put("/kyc/reject/:id", verifyAdminJWT, verifyAdmin, rejectKyc);

/* OTHER */
router.get("/transactions", verifyAdminJWT, verifyAdmin, getAllTransactions);
router.put("/margin", verifyAdminJWT, verifyAdmin, updateMargin);
router.post("/wallets/adjust", verifyAdminJWT, verifyAdmin, adjustWallet);
router.get("/stats", verifyAdminJWT, verifyAdmin, getAdminStats);

export default router;