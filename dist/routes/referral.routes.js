"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ===============================
// referral.routes.ts
// ===============================
const express_1 = __importDefault(require("express"));
const referral_controller_1 = require("../controllers/referral.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
/* GENERATE CODE */
router.post("/generate", auth_1.verifyFirebaseToken, referral_controller_1.generateReferralCode);
/* APPLY REFERRAL */
router.post("/apply", auth_1.verifyFirebaseToken, referral_controller_1.applyReferral);
exports.default = router;
