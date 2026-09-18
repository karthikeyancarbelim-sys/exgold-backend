"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const admin_controller_1 = require("../controllers/admin.controller");
const ticket_controller_1 = require("../controllers/ticket.controller");
const chat_controller_1 = require("../controllers/chat.controller");
const home_controller_1 = require("../controllers/home.controller");
const withdrawal_controller_1 = require("../controllers/withdrawal.controller");
const admin_auth_controller_1 = require("../controllers/admin.auth.controller");
const adminJwt_1 = require("../middleware/adminJwt");
const admin_1 = require("../middleware/admin");
const router = express_1.default.Router();
/* ===============================
   LOGIN
   =============================== */
router.post("/login", admin_auth_controller_1.adminLogin);
router.post("/forgot-password", admin_auth_controller_1.forgotAdminPassword);
router.post("/reset-password", admin_auth_controller_1.resetAdminPassword);
router.get("/me", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_auth_controller_1.adminMe);
router.get("/admins", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAdminAccounts);
router.post("/admins", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.createAdminAccount);
router.put("/admins/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.updateAdminAccount);
router.delete("/admins/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.deleteAdminAccount);
/* ===============================
   DASHBOARD
   =============================== */
router.get("/stats", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getDashboardStats);
router.get("/monitoring", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getMonitoringOverview);
router.get("/audit-logs", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAuditLogs);
/* ===============================
   USERS
   =============================== */
router.get("/users", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAllUsers);
router.post("/users", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.createAdminUser);
router.put("/users/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.updateAdminUser);
router.put("/users/block/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.blockUser);
router.delete("/users/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.deleteAdminUser);
/* ===============================
   ADS
   =============================== */
router.get("/ads", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAllAds);
router.post("/ads", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.createAdminAd);
router.put("/ads/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.updateAdminAd);
router.put("/ads/approve/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.approveAd);
router.delete("/ads/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.deleteAdminAd);
/* ===============================
   KYC
   =============================== */
router.get("/kyc", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAllKyc);
router.put("/kyc/approve/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, (req, res) => {
    req.body = req.body || {};
    req.body.status = "approved";
    return (0, admin_controller_1.updateKycStatus)(req, res);
});
router.put("/kyc/reject/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, (req, res) => {
    req.body = req.body || {};
    req.body.status = "rejected";
    return (0, admin_controller_1.updateKycStatus)(req, res);
});
router.put("/kyc/:step/approve/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, (req, res) => {
    req.body = req.body || {};
    req.body.status = "approved";
    return (0, admin_controller_1.updateKycStatus)(req, res);
});
router.put("/kyc/:step/reject/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, (req, res) => {
    req.body = req.body || {};
    req.body.status = "rejected";
    return (0, admin_controller_1.updateKycStatus)(req, res);
});
router.put("/kyc/reverify/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.forceKycReverify);
/* ===============================
   GOLD RATES / MARGIN
   =============================== */
router.get("/gold-rates", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAdminGoldRates);
router.put("/gold-rates", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.updateAdminGoldRates);
router.put("/margin", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.updateGoldMargin);
/* ===============================
   WALLET
   =============================== */
router.post("/wallets/adjust", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.adjustWallet);
/* ===============================
   TRANSACTIONS
   =============================== */
router.get("/transactions", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAllTransactions);
router.get("/gold-transactions", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAllGoldTransactions);
router.post("/digital-gold/checkouts/:id/reconcile", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.reconcileDigitalGoldCheckout);
router.post("/gold-transactions/:id/reconcile-sale", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.reconcileDigitalGoldSalePayout);
router.post("/augmont-settlements/:id/confirm", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.confirmAugmontMerchantSettlement);
/* ===============================
   SUPPORT TICKETS
   =============================== */
router.get("/tickets", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, ticket_controller_1.getAllTickets);
router.post("/tickets", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, ticket_controller_1.createAdminTicket);
router.put("/tickets/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, ticket_controller_1.updateTicket);
router.delete("/tickets/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, ticket_controller_1.deleteTicket);
/* ===============================
   CHAT CONTROL
   =============================== */
router.get("/chats", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, chat_controller_1.getAllConversations);
router.get("/chats/:id/messages", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, chat_controller_1.getAdminConversationMessages);
router.put("/chats/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, chat_controller_1.updateConversationStatus);
/* ===============================
   HOME SLIDES
   =============================== */
router.get("/slides", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, home_controller_1.getAllHomeSlides);
router.post("/slides", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, home_controller_1.createHomeSlide);
router.put("/slides/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, home_controller_1.updateHomeSlide);
router.delete("/slides/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, home_controller_1.deleteHomeSlide);
/* ===============================
   WITHDRAWAL ACCOUNTS
   =============================== */
router.get("/withdrawal-accounts", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, withdrawal_controller_1.getAllWithdrawalAccounts);
router.post("/withdrawal-accounts/:id/reverify", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, withdrawal_controller_1.reverifyWithdrawalAccount);
router.put("/withdrawal-accounts/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, withdrawal_controller_1.updateWithdrawalAccountStatus);
router.get("/withdrawal-requests", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, withdrawal_controller_1.getAllWithdrawalRequests);
router.put("/withdrawal-requests/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, withdrawal_controller_1.updateWithdrawalRequestStatus);
router.get("/settings", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, withdrawal_controller_1.getAppSettings);
router.put("/settings/:key", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, withdrawal_controller_1.updateAppSetting);
exports.default = router;
