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
    `UPDATE home_slides
     SET subtitle=$1
     WHERE cta_action='investment'
       AND subtitle ILIKE '%coins%'
     RETURNING id, title`,
    ["Buy digital gold, start SIPs and track your gold balance."]
  );
  console.log("home_slides_updated", result.rowCount);
  await pool.end();
})().catch(async (error) => {
  console.error("home_slide_update_error", error.message);
  await pool.end().catch(() => null);
  process.exit(1);
});
