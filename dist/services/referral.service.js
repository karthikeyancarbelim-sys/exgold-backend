"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyReferralReward = void 0;
// ===============================
// services/referral.service.ts
// ===============================
const db_1 = require("../config/db");
const applyReferralReward = async (referrerId, amount) => {
    const client = await db_1.pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("UPDATE wallets SET balance = balance + $1 WHERE user_id=$2", [amount, referrerId]);
        await client.query(`INSERT INTO wallet_transactions
       (user_id, type, amount, reason)
       VALUES ($1,'CREDIT',$2,'REFERRAL')`, [referrerId, amount]);
        await client.query("COMMIT");
    }
    catch {
        await client.query("ROLLBACK");
        throw new Error("Referral reward failed");
    }
    finally {
        client.release();
    }
};
exports.applyReferralReward = applyReferralReward;
