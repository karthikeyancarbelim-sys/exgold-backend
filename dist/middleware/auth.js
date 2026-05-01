"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyFirebaseToken = void 0;
const firebase_1 = __importDefault(require("../config/firebase"));
const db_1 = require("../config/db");
const verifyFirebaseToken = async (req, res, next) => {
    const client = await db_1.pool.connect();
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ message: "Unauthorized - No token" });
        }
        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await firebase_1.default.auth().verifyIdToken(token);
        const uid = decodedToken.uid;
        await client.query("BEGIN");
        /* ===============================
           CHECK USER
           =============================== */
        const existingUser = await client.query("SELECT id FROM users WHERE firebase_uid=$1", [uid]);
        let userId;
        if (existingUser.rows.length === 0) {
            const newUser = await client.query(`INSERT INTO users (firebase_uid, created_at)
         VALUES ($1, NOW())
         RETURNING id`, [uid]);
            userId = newUser.rows[0].id;
            // ✅ create wallet
            await client.query("INSERT INTO wallets (user_id, balance) VALUES ($1, 0)", [userId]);
        }
        else {
            userId = existingUser.rows[0].id;
        }
        await client.query("COMMIT");
        req.user = decodedToken;
        next();
    }
    catch (error) {
        await client.query("ROLLBACK");
        console.error(error);
        return res.status(401).json({ message: "Unauthorized - Invalid token" });
    }
    finally {
        client.release();
    }
};
exports.verifyFirebaseToken = verifyFirebaseToken;
