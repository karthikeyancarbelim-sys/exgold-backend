import { Response } from "express";
import crypto from "crypto";
import { razorpay } from "../config/razorpay";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";

/* ===============================
   CREATE SUBSCRIPTION
   =============================== */
export const createSubscription = async (req: AuthRequest, res: Response) => {
  const { plan_id } = req.body;

  try {
    const subscription = await razorpay.subscriptions.create({
      plan_id,
      total_count: 12,
      customer_notify: 1,
    });

    res.json({
      success: true,
      subscription,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to create subscription",
    });
  }
};

/* ===============================
   VERIFY SUBSCRIPTION PAYMENT
   =============================== */
export const verifySubscription = async (req: AuthRequest, res: Response) => {
  const uid = req.user.uid;

  const {
    razorpay_payment_id,
    razorpay_subscription_id,
    razorpay_signature,
    plan_type,
  } = req.body;

  const client = await pool.connect();

  try {
    const secret = process.env.RAZORPAY_KEY_SECRET!;

    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(razorpay_payment_id + "|" + razorpay_subscription_id)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      throw new Error("Invalid signature");
    }

    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT id FROM users WHERE firebase_uid=$1",
      [uid]
    );

    const userId = userResult.rows[0].id;

    let durationDays = 30;

    if (plan_type === "SIX_MONTHS") durationDays = 180;
    if (plan_type === "YEARLY") durationDays = 365;

    await client.query(
      `UPDATE users
       SET subscription_active=true,
           subscription_start=NOW(),
           subscription_end=NOW() + ($1 || ' days')::interval
       WHERE id=$2`,
      [durationDays, userId]
    );

    await client.query(
      `INSERT INTO transactions
       (user_id, type, amount, status, reference_id)
       VALUES ($1,'SUBSCRIPTION',0,'SUCCESS',$2)`,
      [userId, razorpay_payment_id]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Subscription activated",
    });
  } catch (error: any) {
    await client.query("ROLLBACK");

    res.status(500).json({
      error: error.message,
    });
  } finally {
    client.release();
  }
};