require("dotenv").config();

const { Client } = require("pg");

const tables = [
  "gold_rates",
  "gold_rate_history",
  "gold_margin",
  "gold_transactions",
  "checkout_intents",
  "users",
];

const columns = [
  "karat",
  "price_per_gram",
  "source",
  "kyc_completed_at",
  "merchant_txn_id",
  "status",
];

const normalizeDbHost = (value = "") => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.includes(".apirest.")) {
      const [project, ...rest] = parsed.hostname.split(".apirest.");
      return `${project}-pooler.${rest.join(".apirest.")}`;
    }
    return parsed.hostname;
  } catch {
    return trimmed;
  }
};

const main = async () => {
  if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
    throw new Error("Database connection is not configured");
  }

  const client = new Client(
    process.env.DATABASE_URL
      ? {
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
        }
      : {
          host: normalizeDbHost(process.env.DB_HOST),
          port: Number(process.env.DB_PORT || 5432),
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
        }
  );

  await client.connect();
  try {
    const result = await client.query(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name=ANY($1::text[])
         AND column_name=ANY($2::text[])
       ORDER BY table_name, ordinal_position`,
      [tables, columns]
    );

    const indexes = await client.query(
      `SELECT tablename, indexname
       FROM pg_indexes
       WHERE schemaname='public'
         AND tablename=ANY($1::text[])
       ORDER BY tablename, indexname`,
      [tables]
    );

    console.log(JSON.stringify({ columns: result.rows, indexes: indexes.rows }, null, 2));
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
