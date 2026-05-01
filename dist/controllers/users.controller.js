"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUser = exports.getProfile = void 0;
const db_1 = require("../config/db");
/* ===============================
   GET PROFILE
   =============================== */
const getProfile = async (req, res) => {
    try {
        const uid = req.user.uid;
        const result = await db_1.pool.query("SELECT * FROM users WHERE firebase_uid=$1", [uid]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json(result.rows[0]);
    }
    catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};
exports.getProfile = getProfile;
/* ===============================
   REGISTER USER + CREATE WALLET
   =============================== */
const registerUser = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        const uid = req.user.uid;
        const { name, phone } = req.body;
        await client.query("BEGIN");
        const existingUser = await client.query("SELECT * FROM users WHERE firebase_uid=$1", [uid]);
        if (existingUser.rows.length > 0) {
            await client.query("COMMIT");
            return res.json(existingUser.rows[0]);
        }
        const newUser = await client.query(`INSERT INTO users (firebase_uid, name, phone)
       VALUES ($1, $2, $3)
       RETURNING *`, [uid, name, phone]);
        const userId = newUser.rows[0].id;
        // Create wallet for user
        await client.query("INSERT INTO wallets (user_id, balance) VALUES ($1, 0)", [userId]);
        await client.query("COMMIT");
        res.json(newUser.rows[0]);
    }
    catch (error) {
        await client.query("ROLLBACK");
        res.status(500).json({ message: "Server error" });
    }
    finally {
        client.release();
    }
};
exports.registerUser = registerUser;
