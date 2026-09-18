require("dotenv").config();

const { Pool } = require("pg");

const normalizeDbHost = (host = "") => {
  const trimmed = host.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname;
    if (hostname.includes(".apirest.")) {
      const [project, ...rest] = hostname.split(".apirest.");
      return `${project}-pooler.${rest.join(".apirest.")}`;
    }
    return hostname;
  } catch {
    return trimmed;
  }
};

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {
        user: process.env.DB_USER,
        host: normalizeDbHost(process.env.DB_HOST),
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: Number(process.env.DB_PORT || 5432),
        ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      }
);

(async () => {
  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM classified_ads
     WHERE seller_name='ExGold'
       AND condition='New'
       AND title IN (
         'ExGold 22K Ring',
         'ExGold Gold Chain',
         'ExGold Bangles Pair',
         'ExGold Necklace',
         'ExGold Earrings'
       )
     GROUP BY status
     ORDER BY status`
  );
  console.log("demo_ads_by_status", result.rows);
  await pool.end();
})().catch(async (error) => {
  console.error("check_demo_ads_error", error.message);
  await pool.end().catch(() => null);
  process.exit(1);
});
