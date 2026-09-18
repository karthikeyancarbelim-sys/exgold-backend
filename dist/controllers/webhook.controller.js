"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.razorpayWebhook = void 0;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../config/db");
const razorpay_1 = require("../config/razorpay");
const digital_gold_settlement_service_1 = require("../services/digital-gold-settlement.service");
const razorpayWebhook = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const signature = req.headers["x-razorpay-signature"];
        const rawBody = req.body; // 🔥 raw buffer
        const expected = crypto_1.default
            .createHmac("sha256", secret)
            .update(rawBody)
            .digest("hex");
        if (expected !== signature) {
            return res.status(400).json({ error: "Invalid webhook signature" });
        }
        const event = JSON.parse(rawBody.toString());
        /* ===============================
           WALLET PAYMENT SUCCESS
           =============================== */
        if (event.event === "payment.captured") {
            const payment = event.payload.payment.entity;
            const paymentId = payment.id;
            const orderId = payment.order_id;
            const amount = payment.amount / 100;
            // Checkout payments are fulfilled by the checkout verifier, never by the
            // wallet ledger. Otherwise a product payment could be credited as cash.
            let purpose = payment.notes?.purpose;
            if (!purpose && orderId) {
                const order = await razorpay_1.razorpay.orders.fetch(orderId);
                purpose = order.notes?.purpose;
            }
            if (purpose === "digital_gold") {
                const checkout = await db_1.pool.query("SELECT id FROM checkout_intents WHERE razorpay_order_id=$1 LIMIT 1", [orderId]);
                const checkoutId = String(payment.notes?.checkout_intent_id || checkout.rows[0]?.id || "");
                if (!checkoutId) {
                    throw new Error("Digital gold checkout metadata is missing");
                }
                try {
                    const settlement = await (0, digital_gold_settlement_service_1.settleDigitalGoldCheckout)({ checkoutId, paymentId, orderId });
                    return res.json({ status: settlement.status, checkoutId });
                }
                catch (error) {
                    console.error("DIGITAL GOLD SETTLEMENT PENDING:", checkoutId, error?.message || error);
                    return res.json({ status: "provider_pending", checkoutId });
                }
            }
            if (purpose === "physical_product") {
                return res.json({ status: "checkout payment received" });
            }
            await client.query("BEGIN");
            // 🔒 Prevent duplicate credit
            const existing = await client.query("SELECT id FROM wallet_transactions WHERE reference_id=$1", [paymentId]);
            if (existing.rows.length > 0) {
                await client.query("COMMIT");
                return res.json({ status: "already processed" });
            }
            // 🔎 Get user from metadata
            let uid = payment.notes?.firebase_uid;
            if (!uid && orderId) {
                const order = await razorpay_1.razorpay.orders.fetch(orderId);
                uid = order.notes?.firebase_uid;
            }
            if (!uid) {
                throw new Error("Missing user metadata");
            }
            const userRes = await client.query("SELECT id FROM users WHERE firebase_uid=$1", [uid]);
            const userId = userRes.rows[0].id;
            // 💰 Get wallet
            const walletRes = await client.query("SELECT balance FROM wallets WHERE user_id=$1", [userId]);
            const currentBalance = Number(walletRes.rows[0].balance);
            const newBalance = currentBalance + amount;
            // 💰 Update wallet
            await client.query("UPDATE wallets SET balance=$1 WHERE user_id=$2", [newBalance, userId]);
            // 🧾 Insert transaction
            await client.query(`INSERT INTO wallet_transactions
         (user_id, type, amount, method, reference_id, status)
         VALUES ($1,'credit',$2,'razorpay',$3,'success')`, [userId, amount, paymentId]);
            await client.query("COMMIT");
            return res.json({ status: "wallet updated" });
        }
        /* ===============================
           SUBSCRIPTION CHARGED
           =============================== */
        if (event.event === "subscription.charged") {
            const payment = event.payload.payment.entity;
            await db_1.pool.query(`INSERT INTO transactions (reference_id, type, status)
         VALUES ($1,'SUBSCRIPTION','SUCCESS')`, [payment.id]);
        }
        /* ===============================
           SUBSCRIPTION CANCELLED
           =============================== */
        if (event.event === "subscription.cancelled") {
            const sub = event.payload.subscription.entity;
            await db_1.pool.query(`UPDATE users
         SET subscription_active=false
         WHERE subscription_id=$1`, [sub.id]);
        }
        return res.json({ status: "ok" });
    }
    catch (error) {
        await client.query("ROLLBACK");
        console.error("WEBHOOK ERROR:", error);
        return res.status(500).json({ error: "Webhook failed" });
    }
    finally {
        client.release();
    }
};
exports.razorpayWebhook = razorpayWebhook;
