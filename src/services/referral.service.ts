// ===============================
// services/referral.service.ts
// ===============================
import { pool } from "../config/db";

export const applyReferralReward = async (
  referrerId: number,
  amount: number
) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      "UPDATE wallets SET balance = balance + $1 WHERE user_id=$2",
      [amount, referrerId]
    );

    await client.query(
      `INSERT INTO wallet_transactions
       (user_id, type, amount, reason)
       VALUES ($1,'CREDIT',$2,'REFERRAL')`,
      [referrerId, amount]
    );

    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    throw new Error("Referral reward failed");
  } finally {
    client.release();
  }
};