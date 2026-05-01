"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllSubscriptions = exports.getMySubscription = void 0;
const db_1 = require("../config/db");
const getMySubscription = async (req, res) => {
    try {
        const uid = req.user.uid;
        const result = await db_1.pool.query(`SELECT subscription_active, subscription_start, subscription_end
       FROM users
       WHERE firebase_uid=$1`, [uid]);
        res.json(result.rows[0]);
    }
    catch {
        res.status(500).json({ error: "Failed to fetch subscription" });
    }
};
exports.getMySubscription = getMySubscription;
const getAllSubscriptions = async (_req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT id, name, subscription_active, subscription_end
       FROM users
       ORDER BY subscription_end DESC`);
        res.json(result.rows);
    }
    catch {
        res.status(500).json({ error: "Failed to fetch subscriptions" });
    }
};
exports.getAllSubscriptions = getAllSubscriptions;
