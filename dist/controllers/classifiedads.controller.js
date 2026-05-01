"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAd = exports.updateAd = exports.getMyAds = exports.getAdById = exports.getAds = exports.createAd = void 0;
const db_1 = require("../config/db");
/* ===============================
   CREATE AD
   =============================== */
const createAd = async (req, res) => {
    try {
        const { title, description, grams, purity, wastage, making_charges, city, } = req.body;
        const uid = req.user.uid;
        if (!grams || grams <= 0) {
            return res.status(400).json({ error: "Invalid weight" });
        }
        if (![18, 22, 24].includes(purity)) {
            return res.status(400).json({ error: "Invalid purity" });
        }
        const userResult = await db_1.pool.query("SELECT id, subscription_active, subscription_end FROM users WHERE firebase_uid=$1", [uid]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        const user = userResult.rows[0];
        if (!user.subscription_active ||
            new Date(user.subscription_end) < new Date()) {
            return res.status(403).json({ error: "Subscription required" });
        }
        const rateResult = await db_1.pool.query("SELECT price_per_gram FROM gold_rates WHERE karat=$1", [purity]);
        if (rateResult.rows.length === 0) {
            return res.status(400).json({ error: "Gold rate not found" });
        }
        const goldRate = Number(rateResult.rows[0].price_per_gram);
        const basePrice = goldRate * grams;
        const wastageAmount = wastage ? basePrice * (wastage / 100) : 0;
        const makingCharges = making_charges || 0;
        const finalPrice = Math.round(basePrice + wastageAmount + makingCharges);
        const result = await db_1.pool.query(`INSERT INTO classified_ads 
      (user_id, title, description, grams, purity, wastage, making_charges,
       gold_rate_snapshot, price, city)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`, [
            user.id,
            title,
            description,
            grams,
            purity,
            wastage,
            makingCharges,
            goldRate,
            finalPrice,
            city,
        ]);
        res.json({
            message: "Ad posted successfully",
            ad: result.rows[0],
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to create ad" });
    }
};
exports.createAd = createAd;
/* ===============================
   GET ALL ADS
   =============================== */
const getAds = async (req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT id, title, description, grams, purity, wastage,
              making_charges, price, city, created_at
       FROM classified_ads
       WHERE status='active'
       ORDER BY created_at DESC`);
        res.json(result.rows);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch ads" });
    }
};
exports.getAds = getAds;
/* ===============================
   GET SINGLE AD
   =============================== */
const getAdById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db_1.pool.query(`SELECT * FROM classified_ads WHERE id=$1`, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Ad not found" });
        }
        res.json(result.rows[0]);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch ad" });
    }
};
exports.getAdById = getAdById;
/* ===============================
   GET MY ADS
   =============================== */
const getMyAds = async (req, res) => {
    try {
        const uid = req.user.uid;
        const result = await db_1.pool.query(`SELECT *
       FROM classified_ads
       WHERE user_id = (
         SELECT id FROM users WHERE firebase_uid=$1
       )
       ORDER BY created_at DESC`, [uid]);
        res.json(result.rows);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch ads" });
    }
};
exports.getMyAds = getMyAds;
/* ===============================
   UPDATE AD
   =============================== */
const updateAd = async (req, res) => {
    try {
        const { id } = req.params;
        const uid = req.user.uid;
        const { title, description, grams, purity, wastage, making_charges, city, } = req.body;
        if (!grams || grams <= 0) {
            return res.status(400).json({ error: "Invalid weight" });
        }
        if (![18, 22, 24].includes(purity)) {
            return res.status(400).json({ error: "Invalid purity" });
        }
        const userResult = await db_1.pool.query("SELECT id FROM users WHERE firebase_uid=$1", [uid]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        const userId = userResult.rows[0].id;
        const rateResult = await db_1.pool.query("SELECT price_per_gram FROM gold_rates WHERE karat=$1", [purity]);
        if (rateResult.rows.length === 0) {
            return res.status(400).json({ error: "Gold rate not found" });
        }
        const goldRate = Number(rateResult.rows[0].price_per_gram);
        const basePrice = goldRate * grams;
        const wastageAmount = wastage ? basePrice * (wastage / 100) : 0;
        const makingCharges = making_charges || 0;
        const finalPrice = Math.round(basePrice + wastageAmount + makingCharges);
        const result = await db_1.pool.query(`UPDATE classified_ads SET
        title=$1,
        description=$2,
        grams=$3,
        purity=$4,
        wastage=$5,
        making_charges=$6,
        gold_rate_snapshot=$7,
        price=$8,
        city=$9
       WHERE id=$10 AND user_id=$11
       RETURNING *`, [
            title,
            description,
            grams,
            purity,
            wastage,
            makingCharges,
            goldRate,
            finalPrice,
            city,
            id,
            userId,
        ]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Ad not found or unauthorized" });
        }
        res.json({
            message: "Ad updated successfully",
            ad: result.rows[0],
        });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to update ad" });
    }
};
exports.updateAd = updateAd;
/* ===============================
   DELETE AD
   =============================== */
const deleteAd = async (req, res) => {
    try {
        const { id } = req.params;
        const uid = req.user.uid;
        await db_1.pool.query(`DELETE FROM classified_ads
       WHERE id=$1 
       AND user_id=(
         SELECT id FROM users WHERE firebase_uid=$2
       )`, [id, uid]);
        res.json({ message: "Ad deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to delete ad" });
    }
};
exports.deleteAd = deleteAd;
