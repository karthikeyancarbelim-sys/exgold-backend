"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyKyc = exports.startKyc = void 0;
const db_1 = require("../config/db");
const kyc_service_1 = require("../services/kyc.service");
/* START KYC */
const startKyc = async (req, res) => {
    try {
        const uid = req.user.uid;
        const userResult = await db_1.pool.query("SELECT id, name FROM users WHERE firebase_uid=$1", [uid]);
        const user = userResult.rows[0];
        const kyc = await (0, kyc_service_1.createKycRequest)(user);
        await db_1.pool.query(`INSERT INTO kyc (user_id, status, reference_id)
       VALUES ($1,'pending',$2)`, [user.id, kyc.id]);
        res.json({ success: true, kyc });
    }
    catch (error) {
        res.status(500).json({ error: "KYC initiation failed" });
    }
};
exports.startKyc = startKyc;
/* GET MY KYC */
const getMyKyc = async (req, res) => {
    try {
        const uid = req.user.uid;
        const result = await db_1.pool.query(`SELECT * FROM kyc
       WHERE user_id = (SELECT id FROM users WHERE firebase_uid=$1)`, [uid]);
        res.json(result.rows[0]);
    }
    catch {
        res.status(500).json({ error: "Failed to fetch KYC" });
    }
};
exports.getMyKyc = getMyKyc;
