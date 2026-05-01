"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateGoldRates = exports.getGoldRates = void 0;
const db_1 = require("../config/db");
/* ===============================
   GET GOLD RATES (WITH MARGIN)
   =============================== */
const getGoldRates = async (req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT 
        r.karat,
        r.price_per_gram AS market_price,
        (r.price_per_gram + m.buy_margin) AS buy_price,
        (r.price_per_gram - m.sell_margin) AS sell_price
       FROM gold_rates r
       JOIN gold_margin m ON r.karat = m.karat
       ORDER BY r.karat`);
        res.json(result.rows);
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching gold rates" });
    }
};
exports.getGoldRates = getGoldRates;
/* ===============================
   UPDATE GOLD RATE (ADMIN)
   =============================== */
const updateGoldRates = async (req, res) => {
    try {
        const { karat, price } = req.body;
        if (![18, 22, 24].includes(karat)) {
            return res.status(400).json({ message: "Invalid karat" });
        }
        await db_1.pool.query("UPDATE gold_rates SET price_per_gram=$1, updated_at=NOW() WHERE karat=$2", [price, karat]);
        res.json({ message: "Gold price updated successfully" });
    }
    catch (error) {
        res.status(500).json({ message: "Error updating gold price" });
    }
};
exports.updateGoldRates = updateGoldRates;
