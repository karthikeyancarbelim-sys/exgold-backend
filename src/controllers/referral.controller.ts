// ===============================
// referral.controller.ts
// ===============================
import { Response } from "express";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";

export const generateReferralCode = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;

    const code = "EXG" + Math.random().toString(36).substring(2, 8).toUpperCase();

    await pool.query(
      "UPDATE users SET referral_code=$1 WHERE firebase_uid=$2",
      [code, uid]
    );

    res.json({ code });
  } catch {
    res.status(500).json({ error: "Failed to generate code" });
  }
};

export const applyReferral = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const uid = req.user.uid;
    const { code } = req.body;

    await client.query("BEGIN");

    const user = await client.query(
      "SELECT id FROM users WHERE firebase_uid=$1",
      [uid]
    );

    const refUser = await client.query(
      "SELECT id FROM users WHERE referral_code=$1",
      [code]
    );

    if (refUser.rows.length === 0) {
      throw new Error("Invalid referral code");
    }

    const referrerId = refUser.rows[0].id;
    const userId = user.rows[0].id;

    const reward = 50;

    await client.query(
      "UPDATE wallets SET balance = balance + $1 WHERE user_id=$2",
      [reward, referrerId]
    );

    await client.query(
      `INSERT INTO wallet_transactions
       (user_id, type, amount, method, status)
       VALUES ($1,'credit',$2,'referral','success')`,
      [referrerId, reward]
    );

    await client.query("COMMIT");

    res.json({ message: "Referral applied" });

  } catch (error: any) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
};