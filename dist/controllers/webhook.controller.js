"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.razorpayWebhook = void 0;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../config/db");
const razorpayWebhook = async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];
    const body = JSON.stringify(req.body);
    const expected = crypto_1.default
        .createHmac("sha256", secret)
        .update(body)
        .digest("hex");
    if (expected !== signature) {
        return res.status(400).json({ error: "Invalid webhook signature" });
    }
    const event = req.body.event;
    try {
        if (event === "subscription.charged") {
            const payment = req.body.payload.payment.entity;
            await db_1.pool.query(`INSERT INTO transactions (reference_id, type, status)
         VALUES ($1,'SUBSCRIPTION','SUCCESS')`, [payment.id]);
        }
        if (event === "subscription.cancelled") {
            const sub = req.body.payload.subscription.entity;
            await db_1.pool.query(`UPDATE users
         SET subscription_active=false
         WHERE subscription_id=$1`, [sub.id]);
        }
        res.json({ status: "ok" });
    }
    catch {
        res.status(500).json({ error: "Webhook handling failed" });
    }
};
exports.razorpayWebhook = razorpayWebhook;
