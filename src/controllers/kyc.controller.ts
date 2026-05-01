import { Request, Response } from "express";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";
import { createKycRequest } from "../services/kyc.service";

/* START KYC */
export const startKyc = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;

    const userResult = await pool.query(
      "SELECT id, name FROM users WHERE firebase_uid=$1",
      [uid]
    );

    const user = userResult.rows[0];

    const kyc = await createKycRequest(user);

    await pool.query(
      `INSERT INTO kyc (user_id, status, reference_id)
       VALUES ($1,'pending',$2)`,
      [user.id, kyc.id]
    );

    res.json({ success: true, kyc });
  } catch (error) {
    res.status(500).json({ error: "KYC initiation failed" });
  }
};

/* GET MY KYC */
export const getMyKyc = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;

    const result = await pool.query(
      `SELECT * FROM kyc
       WHERE user_id = (SELECT id FROM users WHERE firebase_uid=$1)`,
      [uid]
    );

    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch KYC" });
  }
};