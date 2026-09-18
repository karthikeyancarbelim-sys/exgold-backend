"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const investment_controller_1 = require("../controllers/investment.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
router.get("/status", auth_1.verifyFirebaseToken, investment_controller_1.getInvestmentStatus);
router.get("/rates", auth_1.verifyFirebaseToken, investment_controller_1.getInvestmentRates);
router.get("/balance", auth_1.verifyFirebaseToken, investment_controller_1.getGoldBalance);
router.get("/portfolio", auth_1.verifyFirebaseToken, investment_controller_1.getGoldBalance);
router.get("/transactions", auth_1.verifyFirebaseToken, investment_controller_1.getMyGoldTransactions);
// Digital gold is purchased only through the verified payment checkout.
router.post("/buy", auth_1.verifyFirebaseToken, (_req, res) => res.status(410).json({ message: "Use the paid checkout flow for digital gold" }));
router.post("/sell", auth_1.verifyFirebaseToken, investment_controller_1.sellGoldInvestment);
router.post("/sip", auth_1.verifyFirebaseToken, investment_controller_1.startSipInvestment);
router.post("/withdraw", auth_1.verifyFirebaseToken, (_req, res) => res.status(501).json({
    message: "Gold redemption is not available until delivery settlement is enabled",
}));
router.post("/redeem", auth_1.verifyFirebaseToken, (_req, res) => res.status(501).json({
    message: "Gold redemption is not available until delivery settlement is enabled",
}));
exports.default = router;
