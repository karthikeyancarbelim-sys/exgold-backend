"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllSubscriptions = exports.getMySubscription = void 0;
const db_1 = require("../config/db");
const getMySubscription = async (req, res) => {
    try {
        const uid = req.user.uid;
        const result = await db_1.pool.query(`SELECT subscription_active, subscription_plan, subscription_start, subscription_end
       FROM users
       WHERE firebase_uid=$1`, [uid]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json(result.rows[0]);
    }
    catch {
        res.status(500).json({ error: "Failed to fetch subscription" });
    }
};
exports.getMySubscription = getMySubscription;
const getAllSubscriptions = async (_req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT id, name, phone, subscription_active, subscription_plan,
              subscription_start, subscription_end
       FROM users
       ORDER BY subscription_active DESC, subscription_end DESC NULLS LAST`);
        res.json(result.rows);
    }
    catch {
        res.status(500).json({ error: "Failed to fetch subscriptions" });
    }
};
exports.getAllSubscriptions = getAllSubscriptions;
