"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const payment_controller_1 = require("../controllers/payment.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
/* ===============================
   WALLET PAYMENT
   =============================== */
router.post("/create-order", auth_1.verifyFirebaseToken, payment_controller_1.createOrder);
router.post("/verify", auth_1.verifyFirebaseToken, payment_controller_1.verifyPayment);
router.post("/checkout/digital-gold", auth_1.verifyFirebaseToken, payment_controller_1.createDigitalGoldCheckout);
router.post("/checkout/physical-products", auth_1.verifyFirebaseToken, payment_controller_1.createPhysicalProductCheckout);
router.post("/checkout/verify", auth_1.verifyFirebaseToken, payment_controller_1.verifyCheckoutPayment);
/* ===============================
   SUBSCRIPTION PAYMENT
   =============================== */
router.post("/create-subscription", auth_1.verifyFirebaseToken, payment_controller_1.createSubscription);
router.post("/verify-subscription", auth_1.verifyFirebaseToken, payment_controller_1.verifySubscription);
exports.default = router;
