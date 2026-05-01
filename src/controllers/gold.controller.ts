import { Request, Response } from "express";
import { pool } from "../config/db";

/* ===============================
   GET GOLD RATES (WITH MARGIN)
   =============================== */
export const getGoldRates = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT 
        r.karat,
        r.price_per_gram AS market_price,
        (r.price_per_gram + m.buy_margin) AS buy_price,
        (r.price_per_gram - m.sell_margin) AS sell_price
       FROM gold_rates r
       JOIN gold_margin m ON r.karat = m.karat
       ORDER BY r.karat`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Error fetching gold rates" });
  }
};

/* ===============================
   UPDATE GOLD RATE (ADMIN)
   =============================== */
export const updateGoldRates = async (req: Request, res: Response) => {
  try {
    const { karat, price } = req.body;

    if (![18, 22, 24].includes(karat)) {
      return res.status(400).json({ message: "Invalid karat" });
    }

    await pool.query(
      "UPDATE gold_rates SET price_per_gram=$1, updated_at=NOW() WHERE karat=$2",
      [price, karat]
    );

    res.json({ message: "Gold price updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error updating gold price" });
  }
};