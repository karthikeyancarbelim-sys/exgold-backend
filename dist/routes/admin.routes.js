"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const admin_controller_1 = require("../controllers/admin.controller");
const admin_auth_controller_1 = require("../controllers/admin.auth.controller");
const adminJwt_1 = require("../middleware/adminJwt");
const admin_1 = require("../middleware/admin");
const router = express_1.default.Router();
/* LOGIN */
router.post("/login", admin_auth_controller_1.adminLogin);
/* USERS */
router.get("/users", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAllUsers);
router.put("/users/block/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.blockUser);
/* ADS */
router.get("/ads", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAllAdsAdmin);
router.put("/ads/approve/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.approveAd);
/* KYC */
router.get("/kyc", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAllKyc);
router.put("/kyc/approve/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.approveKyc);
router.put("/kyc/reject/:id", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.rejectKyc);
/* OTHER */
router.get("/transactions", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAllTransactions);
router.put("/margin", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.updateMargin);
router.post("/wallets/adjust", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.adjustWallet);
router.get("/stats", adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, admin_controller_1.getAdminStats);
exports.default = router;
