// ===============================
// subscription.controller.ts
// ===============================
import { Response } from "express";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";

export const getMySubscription = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;

    const result = await pool.query(
      `SELECT subscription_active, subscription_start, subscription_end
       FROM users
       WHERE firebase_uid=$1`,
      [uid]
    );

    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch subscription" });
  }
};

export const getAllSubscriptions = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, subscription_active, subscription_end
       FROM users
       ORDER BY subscription_end DESC`
    );

    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch subscriptions" });
  }
};