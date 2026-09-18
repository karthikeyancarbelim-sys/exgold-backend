"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySubscriptionSignature = exports.verifyRazorpaySignature = void 0;
// ===============================
// services/payment.service.ts
// ===============================
const crypto_1 = __importDefault(require("crypto"));
const verifyRazorpaySignature = (orderId, paymentId, signature) => {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const generated = crypto_1.default
        .createHmac("sha256", secret)
        .update(orderId + "|" + paymentId)
        .digest("hex");
    return generated === signature;
};
exports.verifyRazorpaySignature = verifyRazorpaySignature;
const verifySubscriptionSignature = (paymentId, subscriptionId, signature) => {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const generated = crypto_1.default
        .createHmac("sha256", secret)
        .update(paymentId + "|" + subscriptionId)
        .digest("hex");
    return generated === signature;
};
exports.verifySubscriptionSignature = verifySubscriptionSignature;
