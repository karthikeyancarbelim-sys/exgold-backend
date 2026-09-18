import express from "express";
import {
  approveAd,
  createAdminAd,
  createAdminAccount,
  createAdminUser,
  deleteAdminAd,
  deleteAdminAccount,
  deleteAdminUser,
  getAdminAccounts,
  getAllUsers,
  getAllAds,
  getAllKyc,
  getAllTransactions,
  getAllGoldTransactions,
  reconcileDigitalGoldCheckout,
  reconcileDigitalGoldSalePayout,
  confirmAugmontMerchantSettlement,
  getAdminGoldRates,
  getAuditLogs,
  getDashboardStats,
  forceKycReverify,
  getMonitoringOverview,
  adjustWallet,
  blockUser,
  updateAdminAd,
  updateAdminAccount,
  updateAdminGoldRates,
  updateAdminUser,
  updateGoldMargin,
  updateKycStatus
} from "../controllers/admin.controller";
import { createAdminTicket, getAllTickets, updateTicket, deleteTicket } from "../controllers/ticket.controller";
import {
  getAdminConversationMessages,
  getAllConversations,
  updateConversationStatus,
} from "../controllers/chat.controller";
import {
  createHomeSlide,
  deleteHomeSlide,
  getAllHomeSlides,
  updateHomeSlide,
} from "../controllers/home.controller";
import {
  getAllWithdrawalAccounts,
  getAllWithdrawalRequests,
  getAppSettings,
  reverifyWithdrawalAccount,
  updateAppSetting,
  updateWithdrawalAccountStatus,
  updateWithdrawalRequestStatus,
} from "../controllers/withdrawal.controller";

import { adminLogin, adminMe, forgotAdminPassword, resetAdminPassword } from "../controllers/admin.auth.controller";
import { verifyAdminJWT } from "../middleware/adminJwt";
import { verifyAdmin } from "../middleware/admin";

const router = express.Router();

/* ===============================
   LOGIN
   =============================== */
router.post("/login", adminLogin);
router.post("/forgot-password", forgotAdminPassword);
router.post("/reset-password", resetAdminPassword);
router.get("/me", verifyAdminJWT, verifyAdmin, adminMe);

router.get("/admins", verifyAdminJWT, verifyAdmin, getAdminAccounts);
router.post("/admins", verifyAdminJWT, verifyAdmin, createAdminAccount);
router.put("/admins/:id", verifyAdminJWT, verifyAdmin, updateAdminAccount);
router.delete("/admins/:id", verifyAdminJWT, verifyAdmin, deleteAdminAccount);

/* ===============================
   DASHBOARD
   =============================== */
router.get("/stats", verifyAdminJWT, verifyAdmin, getDashboardStats);
router.get("/monitoring", verifyAdminJWT, verifyAdmin, getMonitoringOverview);
router.get("/audit-logs", verifyAdminJWT, verifyAdmin, getAuditLogs);

/* ===============================
   USERS
   =============================== */
router.get("/users", verifyAdminJWT, verifyAdmin, getAllUsers);
router.post("/users", verifyAdminJWT, verifyAdmin, createAdminUser);
router.put("/users/:id", verifyAdminJWT, verifyAdmin, updateAdminUser);
router.put("/users/block/:id", verifyAdminJWT, verifyAdmin, blockUser);
router.delete("/users/:id", verifyAdminJWT, verifyAdmin, deleteAdminUser);

/* ===============================
   ADS
   =============================== */
router.get("/ads", verifyAdminJWT, verifyAdmin, getAllAds);
router.post("/ads", verifyAdminJWT, verifyAdmin, createAdminAd);
router.put("/ads/:id", verifyAdminJWT, verifyAdmin, updateAdminAd);
router.put("/ads/approve/:id", verifyAdminJWT, verifyAdmin, approveAd);
router.delete("/ads/:id", verifyAdminJWT, verifyAdmin, deleteAdminAd);

/* ===============================
   KYC
   =============================== */
router.get("/kyc", verifyAdminJWT, verifyAdmin, getAllKyc);
router.put("/kyc/approve/:id", verifyAdminJWT, verifyAdmin, (req, res) => {
  req.body = req.body || {};
  req.body.status = "approved";
  return updateKycStatus(req, res);
});
router.put("/kyc/reject/:id", verifyAdminJWT, verifyAdmin, (req, res) => {
  req.body = req.body || {};
  req.body.status = "rejected";
  return updateKycStatus(req, res);
});
router.put("/kyc/:step/approve/:id", verifyAdminJWT, verifyAdmin, (req, res) => {
  req.body = req.body || {};
  req.body.status = "approved";
  return updateKycStatus(req, res);
});
router.put("/kyc/:step/reject/:id", verifyAdminJWT, verifyAdmin, (req, res) => {
  req.body = req.body || {};
  req.body.status = "rejected";
  return updateKycStatus(req, res);
});
router.put("/kyc/reverify/:id", verifyAdminJWT, verifyAdmin, forceKycReverify);

/* ===============================
   GOLD RATES / MARGIN
   =============================== */
router.get("/gold-rates", verifyAdminJWT, verifyAdmin, getAdminGoldRates);
router.put("/gold-rates", verifyAdminJWT, verifyAdmin, updateAdminGoldRates);
router.put("/margin", verifyAdminJWT, verifyAdmin, updateGoldMargin);

/* ===============================
   WALLET
   =============================== */
router.post("/wallets/adjust", verifyAdminJWT, verifyAdmin, adjustWallet);

/* ===============================
   TRANSACTIONS
   =============================== */
router.get("/transactions", verifyAdminJWT, verifyAdmin, getAllTransactions);
router.get("/gold-transactions", verifyAdminJWT, verifyAdmin, getAllGoldTransactions);
router.post(
  "/digital-gold/checkouts/:id/reconcile",
  verifyAdminJWT,
  verifyAdmin,
  reconcileDigitalGoldCheckout
);
router.post(
  "/gold-transactions/:id/reconcile-sale",
  verifyAdminJWT,
  verifyAdmin,
  reconcileDigitalGoldSalePayout
);
router.post(
  "/augmont-settlements/:id/confirm",
  verifyAdminJWT,
  verifyAdmin,
  confirmAugmontMerchantSettlement
);

/* ===============================
   SUPPORT TICKETS
   =============================== */
router.get("/tickets", verifyAdminJWT, verifyAdmin, getAllTickets);
router.post("/tickets", verifyAdminJWT, verifyAdmin, createAdminTicket);
router.put("/tickets/:id", verifyAdminJWT, verifyAdmin, updateTicket);
router.delete("/tickets/:id", verifyAdminJWT, verifyAdmin, deleteTicket);

/* ===============================
   CHAT CONTROL
   =============================== */
router.get("/chats", verifyAdminJWT, verifyAdmin, getAllConversations);
router.get("/chats/:id/messages", verifyAdminJWT, verifyAdmin, getAdminConversationMessages);
router.put("/chats/:id", verifyAdminJWT, verifyAdmin, updateConversationStatus);

/* ===============================
   HOME SLIDES
   =============================== */
router.get("/slides", verifyAdminJWT, verifyAdmin, getAllHomeSlides);
router.post("/slides", verifyAdminJWT, verifyAdmin, createHomeSlide);
router.put("/slides/:id", verifyAdminJWT, verifyAdmin, updateHomeSlide);
router.delete("/slides/:id", verifyAdminJWT, verifyAdmin, deleteHomeSlide);

/* ===============================
   WITHDRAWAL ACCOUNTS
   =============================== */
router.get("/withdrawal-accounts", verifyAdminJWT, verifyAdmin, getAllWithdrawalAccounts);
router.post("/withdrawal-accounts/:id/reverify", verifyAdminJWT, verifyAdmin, reverifyWithdrawalAccount);
router.put("/withdrawal-accounts/:id", verifyAdminJWT, verifyAdmin, updateWithdrawalAccountStatus);
router.get("/withdrawal-requests", verifyAdminJWT, verifyAdmin, getAllWithdrawalRequests);
router.put("/withdrawal-requests/:id", verifyAdminJWT, verifyAdmin, updateWithdrawalRequestStatus);
router.get("/settings", verifyAdminJWT, verifyAdmin, getAppSettings);
router.put("/settings/:key", verifyAdminJWT, verifyAdmin, updateAppSetting);

export default router;
