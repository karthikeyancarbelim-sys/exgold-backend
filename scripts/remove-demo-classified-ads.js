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
    `UPDATE classified_ads
     SET status='deleted'
     WHERE seller_name='ExGold'
       AND condition='New'
       AND title IN (
         'ExGold 22K Ring',
         'ExGold Gold Chain',
         'ExGold Bangles Pair',
         'ExGold Necklace',
         'ExGold Earrings'
       )
     RETURNING id, title`
  );
  console.log("demo_ads_deleted", result.rowCount);
  await pool.end();
})().catch(async (error) => {
  console.error("remove_demo_ads_error", error.message);
  await pool.end().catch(() => null);
  process.exit(1);
});
