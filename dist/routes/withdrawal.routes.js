"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const withdrawal_controller_1 = require("../controllers/withdrawal.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
router.get("/capabilities", auth_1.verifyFirebaseToken, withdrawal_controller_1.getPayoutCapabilities);
router.get("/account", auth_1.verifyFirebaseToken, withdrawal_controller_1.getWithdrawalAccount);
router.put("/account", auth_1.verifyFirebaseToken, withdrawal_controller_1.upsertWithdrawalAccount);
router.get("/requests", auth_1.verifyFirebaseToken, withdrawal_controller_1.getMyWithdrawalRequests);
router.post("/requests", auth_1.verifyFirebaseToken, withdrawal_controller_1.createWithdrawalRequest);
exports.default = router;
