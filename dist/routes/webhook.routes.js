"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ===============================
// webhook.routes.ts
// ===============================
const express_1 = __importDefault(require("express"));
const webhook_controller_1 = require("../controllers/webhook.controller");
const router = express_1.default.Router();
/* ===============================
   RAZORPAY WEBHOOK (RAW BODY)
   =============================== */
router.post("/razorpay", express_1.default.raw({ type: "*/*" }), // ✅ MUST be raw
webhook_controller_1.razorpayWebhook);
exports.default = router;
