import { Request, Response } from "express";
import { pool } from "../config/db";

/* ALL USERS */
export const getAllUsers = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM users ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

/* BLOCK USER */
export const blockUser = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await pool.query(
      "UPDATE users SET is_blocked=true WHERE id=$1",
      [id]
    );

    res.json({ message: "User blocked" });
  } catch {
    res.status(500).json({ error: "Failed to block user" });
  }
};

/* ALL TRANSACTIONS */
export const getAllTransactions = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM gold_transactions ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
};

/* UPDATE MARGIN */
export const updateMargin = async (req: Request, res: Response) => {
  try {
    const { karat, buy_margin, sell_margin } = req.body;

    await pool.query(
      "UPDATE gold_margin SET buy_margin=$1, sell_margin=$2 WHERE karat=$3",
      [buy_margin, sell_margin, karat]
    );

    res.json({ message: "Margin updated" });
  } catch {
    res.status(500).json({ error: "Failed to update margin" });
  }
};

/* ADMIN DASHBOARD STATS */
export const getAdminStats = async (_req: Request, res: Response) => {
  try {
    const users = await pool.query("SELECT COUNT(*) FROM users");

    const revenue = await pool.query(
      "SELECT COALESCE(SUM(amount),0) AS total FROM gold_transactions WHERE type='buy'"
    );

    const goldSold = await pool.query(
      "SELECT COALESCE(SUM(grams),0) AS total FROM gold_transactions WHERE type='buy'"
    );

    const pendingKyc = await pool.query(
      "SELECT COUNT(*) FROM kyc WHERE status='pending'"
    );

    const pendingAds = await pool.query(
      "SELECT COUNT(*) FROM classified_ads WHERE status='pending'"
    );

    res.json({
      users: Number(users.rows[0].count) || 0,
      revenue: Number(revenue.rows[0].total) || 0,
      goldSold: Number(goldSold.rows[0].total) || 0,
      pendingKyc: Number(pendingKyc.rows[0].count) || 0,
      pendingAds: Number(pendingAds.rows[0].count) || 0,
    });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
};

/* WALLET ADJUST */
export const adjustWallet = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { user_id, amount, type } = req.body;

    await client.query("BEGIN");

    if (type === "credit") {
      await client.query(
        "UPDATE wallets SET balance = balance + $1 WHERE user_id=$2",
        [amount, user_id]
      );
    } else {
      await client.query(
        "UPDATE wallets SET balance = balance - $1 WHERE user_id=$2 AND balance >= $1",
        [amount, user_id]
      );
    }

    await client.query(
      `INSERT INTO wallet_transactions 
       (user_id, amount, type, reason) 
       VALUES ($1,$2,$3,$4)`,
      [user_id, amount, type.toUpperCase(), "ADMIN_ADJUST"]
    );

    await client.query("COMMIT");

    res.json({ message: "Wallet adjusted" });
  } catch {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Wallet update failed" });
  } finally {
    client.release();
  }
};

/* ADS ADMIN */
export const getAllAdsAdmin = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM classified_ads ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch ads" });
  }
};

export const approveAd = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await pool.query(
      "UPDATE classified_ads SET status='active' WHERE id=$1",
      [id]
    );

    res.json({ message: "Ad approved" });
  } catch {
    res.status(500).json({ error: "Failed to approve ad" });
  }
};

/* KYC ADMIN */
export const getAllKyc = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM kyc ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch KYC" });
  }
};

export const approveKyc = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await pool.query(
      "UPDATE kyc SET status='approved' WHERE id=$1",
      [id]
    );

    res.json({ message: "KYC approved" });
  } catch {
    res.status(500).json({ error: "Failed to approve KYC" });
  }
};

export const rejectKyc = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await pool.query(
      "UPDATE kyc SET status='rejected' WHERE id=$1",
      [id]
    );

    res.json({ message: "KYC rejected" });
  } catch {
    res.status(500).json({ error: "Failed to reject KYC" });
  }
};