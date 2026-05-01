import { Response } from "express";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";

/* ===============================
   GET WALLET BALANCE
   =============================== */
export const getWallet = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;

    const userResult = await pool.query(
      "SELECT id FROM users WHERE firebase_uid=$1",
      [uid]
    );

    const walletResult = await pool.query(
      "SELECT balance FROM wallets WHERE user_id=$1",
      [userResult.rows[0].id]
    );

    res.json(walletResult.rows[0]);

  } catch (err) {
    res.status(500).json({ error: "Failed to fetch wallet" });
  }
};

/* ===============================
   WALLET TRANSACTION HISTORY
   =============================== */
export const getWalletHistory = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;

    const userResult = await pool.query(
      "SELECT id FROM users WHERE firebase_uid=$1",
      [uid]
    );

    const result = await pool.query(
      `SELECT type, amount, method, status, created_at
       FROM wallet_transactions
       WHERE user_id=$1
       ORDER BY created_at DESC`,
      [userResult.rows[0].id]
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: "Failed to fetch wallet history" });
  }
};