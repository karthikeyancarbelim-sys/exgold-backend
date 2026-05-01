"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWalletHistory = exports.getWallet = void 0;
const db_1 = require("../config/db");
/* ===============================
   GET WALLET BALANCE
   =============================== */
const getWallet = async (req, res) => {
    try {
        const uid = req.user.uid;
        const userResult = await db_1.pool.query("SELECT id FROM users WHERE firebase_uid=$1", [uid]);
        const walletResult = await db_1.pool.query("SELECT balance FROM wallets WHERE user_id=$1", [userResult.rows[0].id]);
        res.json(walletResult.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch wallet" });
    }
};
exports.getWallet = getWallet;
/* ===============================
   WALLET TRANSACTION HISTORY
   =============================== */
const getWalletHistory = async (req, res) => {
    try {
        const uid = req.user.uid;
        const userResult = await db_1.pool.query("SELECT id FROM users WHERE firebase_uid=$1", [uid]);
        const result = await db_1.pool.query(`SELECT type, amount, method, status, created_at
       FROM wallet_transactions
       WHERE user_id=$1
       ORDER BY created_at DESC`, [userResult.rows[0].id]);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch wallet history" });
    }
};
exports.getWalletHistory = getWalletHistory;
