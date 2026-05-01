import { Response } from "express";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";

/* ===============================
   GET PROFILE
   =============================== */
export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;

    const result = await pool.query(
      "SELECT * FROM users WHERE firebase_uid=$1",
      [uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

/* ===============================
   REGISTER USER + CREATE WALLET
   =============================== */
export const registerUser = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const uid = req.user.uid;
    const { name, phone } = req.body;

    await client.query("BEGIN");

    const existingUser = await client.query(
      "SELECT * FROM users WHERE firebase_uid=$1",
      [uid]
    );

    if (existingUser.rows.length > 0) {
      await client.query("COMMIT");
      return res.json(existingUser.rows[0]);
    }

    const newUser = await client.query(
      `INSERT INTO users (firebase_uid, name, phone)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [uid, name, phone]
    );

    const userId = newUser.rows[0].id;

    // Create wallet for user
    await client.query(
      "INSERT INTO wallets (user_id, balance) VALUES ($1, 0)",
      [userId]
    );

    await client.query("COMMIT");

    res.json(newUser.rows[0]);

  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};