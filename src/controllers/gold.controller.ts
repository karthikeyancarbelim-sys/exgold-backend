import { Request, Response } from "express";
import { pool } from "../config/db";
import { augmontGetRates, extractDeep } from "../services/augmont.service";

const rateKeys = [
  "gBuy",
  "goldBuy",
  "gold_buy",
  "buyRate",
  "buy_rate",
  "rate",
  "price",
];

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

type PersistedRateState = {
  price24k: number;
  indiaDay: string;
};

let persistedRateState: PersistedRateState | null = null;
let ratePersistRequest: Promise<void> | null = null;

const getIndiaDay = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const getAugmont24kRate = async () => {
  const payload = await augmontGetRates();
  const rate = toNumber(extractDeep(payload, rateKeys));
  return rate > 0 ? rate : 0;
};

const karatSql = (alias: string) => `NULLIF(regexp_replace(${alias}.karat::text, '[^0-9]', '', 'g'), '')::int`;

const upsertDerivedRates = async (price24k: number) => {
  const rates = [
    { karat: 24, price: price24k },
    { karat: 22, price: Number(((price24k * 22) / 24).toFixed(2)) },
    { karat: 18, price: Number(((price24k * 18) / 24).toFixed(2)) },
  ];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const rate of rates) {
      const existing = await client.query(
        `SELECT 1
         FROM gold_rates
         WHERE NULLIF(regexp_replace(karat::text, '[^0-9]', '', 'g'), '')::int=$1
         LIMIT 1`,
        [rate.karat]
      );

      if (existing.rows.length) {
        await client.query(
          `UPDATE gold_rates
           SET price_per_gram=$1,
               updated_at=CASE
                 WHEN price_per_gram IS DISTINCT FROM $1::numeric THEN NOW()
                 ELSE updated_at
               END
           WHERE NULLIF(regexp_replace(karat::text, '[^0-9]', '', 'g'), '')::int=$2`,
          [rate.price, rate.karat]
        );
      } else {
        await client.query(
          `INSERT INTO gold_rates (karat, price_per_gram, updated_at)
           VALUES ($1, $2, NOW())`,
          [String(rate.karat), rate.price]
        );
      }

      await client.query(
        `INSERT INTO gold_rate_history (karat, price_per_gram, source, created_at)
         SELECT $1, $2, 'augmont', NOW()
         WHERE NOT EXISTS (
           SELECT 1
           FROM gold_rate_history h
           WHERE NULLIF(regexp_replace(h.karat::text, '[^0-9]', '', 'g'), '')::int=$1
             AND (h.created_at AT TIME ZONE 'Asia/Kolkata')::date =
                 (NOW() AT TIME ZONE 'Asia/Kolkata')::date
         )`,
        [String(rate.karat), rate.price]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const persistDerivedRatesWhenNeeded = async (price24k: number) => {
  if (ratePersistRequest) {
    await ratePersistRequest;
  }

  const indiaDay = getIndiaDay();
  if (
    persistedRateState?.indiaDay === indiaDay &&
    Math.abs(persistedRateState.price24k - price24k) < 0.005
  ) {
    return;
  }

  ratePersistRequest = upsertDerivedRates(price24k)
    .then(() => {
      persistedRateState = { price24k, indiaDay };
    })
    .finally(() => {
      ratePersistRequest = null;
    });

  await ratePersistRequest;
};

/* ===============================
   GET GOLD RATES (WITH MARGIN)
   =============================== */
export const getGoldRates = async (req: Request, res: Response) => {
  try {
    try {
      const augmont24k = await getAugmont24kRate();
      if (augmont24k > 0) {
        await persistDerivedRatesWhenNeeded(augmont24k);
      }
    } catch (error: any) {
      console.warn("AUGMONT RATE FALLBACK:", error?.message || error);
    }

    const result = await pool.query(
      `SELECT DISTINCT ON (${karatSql("r")})
        r.karat,
        r.price_per_gram AS market_price,
        (r.price_per_gram + COALESCE(m.buy_margin, 0)) AS buy_price,
        (r.price_per_gram - COALESCE(m.sell_margin, 0)) AS sell_price,
        COALESCE(prev.price_per_gram, r.price_per_gram) AS yesterday_price,
        (r.price_per_gram - COALESCE(prev.price_per_gram, r.price_per_gram)) AS price_change,
        CASE
          WHEN COALESCE(prev.price_per_gram, 0) = 0 THEN 0
          ELSE ROUND((((r.price_per_gram - prev.price_per_gram) / prev.price_per_gram) * 100)::numeric, 2)
        END AS percent_change,
        r.updated_at,
        'augmont_or_manual_fallback' AS source
       FROM gold_rates r
       LEFT JOIN gold_margin m ON ${karatSql("r")} = ${karatSql("m")}
       LEFT JOIN LATERAL (
         SELECT price_per_gram
         FROM gold_rate_history h
         WHERE ${karatSql("h")} = ${karatSql("r")}
           AND (h.created_at AT TIME ZONE 'Asia/Kolkata')::date <
               (NOW() AT TIME ZONE 'Asia/Kolkata')::date
         ORDER BY h.created_at DESC
         LIMIT 1
       ) prev ON true
       WHERE ${karatSql("r")} IN (18, 22, 24)
         AND r.price_per_gram > 0
       ORDER BY ${karatSql("r")}, r.updated_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("GET GOLD RATES ERROR:", error);
    res.status(500).json({ message: "Gold rates unavailable" });
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

    const updated = await pool.query(
      `UPDATE gold_rates
       SET price_per_gram=$1, updated_at=NOW()
       WHERE NULLIF(regexp_replace(karat::text, '[^0-9]', '', 'g'), '')::int=$2`,
      [price, karat]
    );

    if (updated.rowCount === 0) {
      await pool.query(
        `INSERT INTO gold_rates (karat, price_per_gram, updated_at)
         VALUES ($1, $2, NOW())`,
        [String(karat), price]
      );
    }

    res.json({ message: "Gold price updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error updating gold price" });
  }
};
