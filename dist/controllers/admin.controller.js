"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectKyc = exports.approveKyc = exports.getAllKyc = exports.approveAd = exports.getAllAdsAdmin = exports.adjustWallet = exports.getAdminStats = exports.updateMargin = exports.getAllTransactions = exports.blockUser = exports.getAllUsers = void 0;
const db_1 = require("../config/db");
/* ALL USERS */
const getAllUsers = async (_req, res) => {
    try {
        const result = await db_1.pool.query("SELECT * FROM users ORDER BY created_at DESC");
        res.json(result.rows);
    }
    catch {
        res.status(500).json({ error: "Failed to fetch users" });
    }
};
exports.getAllUsers = getAllUsers;
/* BLOCK USER */
const blockUser = async (req, res) => {
    const { id } = req.params;
    try {
        await db_1.pool.query("UPDATE users SET is_blocked=true WHERE id=$1", [id]);
        res.json({ message: "User blocked" });
    }
    catch {
        res.status(500).json({ error: "Failed to block user" });
    }
};
exports.blockUser = blockUser;
/* ALL TRANSACTIONS */
const getAllTransactions = async (_req, res) => {
    try {
        const result = await db_1.pool.query("SELECT * FROM gold_transactions ORDER BY created_at DESC");
        res.json(result.rows);
    }
    catch {
        res.status(500).json({ error: "Failed to fetch transactions" });
    }
};
exports.getAllTransactions = getAllTransactions;
/* UPDATE MARGIN */
const updateMargin = async (req, res) => {
    try {
        const { karat, buy_margin, sell_margin } = req.body;
        await db_1.pool.query("UPDATE gold_margin SET buy_margin=$1, sell_margin=$2 WHERE karat=$3", [buy_margin, sell_margin, karat]);
        res.json({ message: "Margin updated" });
    }
    catch {
        res.status(500).json({ error: "Failed to update margin" });
    }
};
exports.updateMargin = updateMargin;
/* ADMIN DASHBOARD STATS */
const getAdminStats = async (_req, res) => {
    try {
        const users = await db_1.pool.query("SELECT COUNT(*) FROM users");
        const revenue = await db_1.pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM gold_transactions WHERE type='buy'");
        const goldSold = await db_1.pool.query("SELECT COALESCE(SUM(grams),0) AS total FROM gold_transactions WHERE type='buy'");
        const pendingKyc = await db_1.pool.query("SELECT COUNT(*) FROM kyc WHERE status='pending'");
        const pendingAds = await db_1.pool.query("SELECT COUNT(*) FROM classified_ads WHERE status='pending'");
        res.json({
            users: Number(users.rows[0].count) || 0,
            revenue: Number(revenue.rows[0].total) || 0,
            goldSold: Number(goldSold.rows[0].total) || 0,
            pendingKyc: Number(pendingKyc.rows[0].count) || 0,
            pendingAds: Number(pendingAds.rows[0].count) || 0,
        });
    }
    catch {
        res.status(500).json({ error: "Server error" });
    }
};
exports.getAdminStats = getAdminStats;
/* WALLET ADJUST */
const adjustWallet = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        const { user_id, amount, type } = req.body;
        await client.query("BEGIN");
        if (type === "credit") {
            await client.query("UPDATE wallets SET balance = balance + $1 WHERE user_id=$2", [amount, user_id]);
        }
        else {
            await client.query("UPDATE wallets SET balance = balance - $1 WHERE user_id=$2 AND balance >= $1", [amount, user_id]);
        }
        await client.query(`INSERT INTO wallet_transactions 
       (user_id, amount, type, reason) 
       VALUES ($1,$2,$3,$4)`, [user_id, amount, type.toUpperCase(), "ADMIN_ADJUST"]);
        await client.query("COMMIT");
        res.json({ message: "Wallet adjusted" });
    }
    catch {
        await client.query("ROLLBACK");
        res.status(500).json({ error: "Wallet update failed" });
    }
    finally {
        client.release();
    }
};
exports.adjustWallet = adjustWallet;
/* ADS ADMIN */
const getAllAdsAdmin = async (_req, res) => {
    try {
        const result = await db_1.pool.query("SELECT * FROM classified_ads ORDER BY created_at DESC");
        res.json(result.rows);
    }
    catch {
        res.status(500).json({ error: "Failed to fetch ads" });
    }
};
exports.getAllAdsAdmin = getAllAdsAdmin;
const approveAd = async (req, res) => {
    const { id } = req.params;
    try {
        await db_1.pool.query("UPDATE classified_ads SET status='active' WHERE id=$1", [id]);
        res.json({ message: "Ad approved" });
    }
    catch {
        res.status(500).json({ error: "Failed to approve ad" });
    }
};
exports.approveAd = approveAd;
/* KYC ADMIN */
const getAllKyc = async (_req, res) => {
    try {
        const result = await db_1.pool.query("SELECT * FROM kyc ORDER BY created_at DESC");
        res.json(result.rows);
    }
    catch {
        res.status(500).json({ error: "Failed to fetch KYC" });
    }
};
exports.getAllKyc = getAllKyc;
const approveKyc = async (req, res) => {
    const { id } = req.params;
    try {
        await db_1.pool.query("UPDATE kyc SET status='approved' WHERE id=$1", [id]);
        res.json({ message: "KYC approved" });
    }
    catch {
        res.status(500).json({ error: "Failed to approve KYC" });
    }
};
exports.approveKyc = approveKyc;
const rejectKyc = async (req, res) => {
    const { id } = req.params;
    try {
        await db_1.pool.query("UPDATE kyc SET status='rejected' WHERE id=$1", [id]);
        res.json({ message: "KYC rejected" });
    }
    catch {
        res.status(500).json({ error: "Failed to reject KYC" });
    }
};
exports.rejectKyc = rejectKyc;
