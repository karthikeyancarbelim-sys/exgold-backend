// ===============================
// webhook.controller.ts
// ===============================
import { Request, Response } from "express";
import crypto from "crypto";
import { pool } from "../config/db";

export const razorpayWebhook = async (req: Request, res: Response) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET!;

  const signature = req.headers["x-razorpay-signature"] as string;

  const body = JSON.stringify(req.body);

  const expected = crypto
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

      await pool.query(
        `INSERT INTO transactions (reference_id, type, status)
         VALUES ($1,'SUBSCRIPTION','SUCCESS')`,
        [payment.id]
      );
    }

    if (event === "subscription.cancelled") {
      const sub = req.body.payload.subscription.entity;

      await pool.query(
        `UPDATE users
         SET subscription_active=false
         WHERE subscription_id=$1`,
        [sub.id]
      );
    }

    res.json({ status: "ok" });
  } catch {
    res.status(500).json({ error: "Webhook handling failed" });
  }
};