import { Request, Response, NextFunction } from "express";
import admin from "../config/firebase";
import { pool } from "../config/db";

export interface AuthRequest extends Request {
  user?: any;
}

export const verifyFirebaseToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const client = await pool.connect();

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized - No token" });
    }

    const token = authHeader.split("Bearer ")[1];

    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

    await client.query("BEGIN");

    /* ===============================
       CHECK USER
       =============================== */
    const existingUser = await client.query(
      "SELECT id FROM users WHERE firebase_uid=$1",
      [uid]
    );

    let userId;

    if (existingUser.rows.length === 0) {
      const newUser = await client.query(
        `INSERT INTO users (firebase_uid, created_at)
         VALUES ($1, NOW())
         RETURNING id`,
        [uid]
      );

      userId = newUser.rows[0].id;

      // ✅ create wallet
      await client.query(
        "INSERT INTO wallets (user_id, balance) VALUES ($1, 0)",
        [userId]
      );
    } else {
      userId = existingUser.rows[0].id;
    }

    await client.query("COMMIT");

    req.user = decodedToken;

    next();
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(401).json({ message: "Unauthorized - Invalid token" });
  } finally {
    client.release();
  }
};