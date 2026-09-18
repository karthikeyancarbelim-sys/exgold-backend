const path = require("path");
require(path.join(process.cwd(), "node_modules/dotenv")).config();

const { Pool } = require(path.join(process.cwd(), "node_modules/pg"));
const { getAugmontDirectPayoutSafety } = require(
  path.join(process.cwd(), "dist/utils/provider-environment")
);

const normalizeDbHost = (host = "") => {
  const trimmed = host.trim();
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

const databaseUrl = process.env.DATABASE_URL || "";
const pool = new Pool(
  databaseUrl && !databaseUrl.includes("YOUR_PASSWORD")
    ? {
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
      }
    : {
        user: process.env.DB_USER,
        host: normalizeDbHost(process.env.DB_HOST || ""),
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: Number(process.env.DB_PORT || 5432),
        ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      }
);

const requiredColumns = [
  "withdrawal_account_id",
  "payout_route",
  "payout_status",
  "payout_reference",
  "gold_restored_at",
  "settled_at",
];

const run = async () => {
  const columns = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name='gold_transactions'
       AND column_name = ANY($1::text[])`,
    [requiredColumns]
  );
  const found = new Set(columns.rows.map((row) => row.column_name));
  const safety = getAugmontDirectPayoutSafety();
  const legacySaleId = Number(process.env.LEGACY_SALE_ID || 26);
  const anchor = await pool.query(
    "SELECT user_id FROM gold_transactions WHERE id=$1 LIMIT 1",
    [legacySaleId]
  );
  const userId = anchor.rows[0]?.user_id;
  let legacyLedger = null;
  if (userId) {
    const [gold, checkouts, wallet, walletTransactions, withdrawals] = await Promise.all([
      pool.query(
        `SELECT id, type, amount, gold_grams, status, payout_route, payout_status,
                (COALESCE(augmont_txn_id,'') <> '') AS has_augmont_reference
         FROM gold_transactions
         WHERE user_id=$1
         ORDER BY id DESC
         LIMIT 10`,
        [userId]
      ),
      pool.query(
        `SELECT id, amount, status,
                RIGHT(COALESCE(razorpay_payment_id,''),6) AS payment_reference_suffix
         FROM checkout_intents
         WHERE user_id=$1 AND purpose='digital_gold'
         ORDER BY created_at DESC
         LIMIT 10`,
        [userId]
      ),
      pool.query(
        "SELECT balance, reserved_balance FROM wallets WHERE user_id=$1 LIMIT 1",
        [userId]
      ),
      pool.query(
        `SELECT id, type, amount, method, status
         FROM wallet_transactions
         WHERE user_id=$1
         ORDER BY id DESC
         LIMIT 10`,
        [userId]
      ),
      pool.query(
        `SELECT id, amount, method, status,
                (COALESCE(processed_reference,'') <> '') AS has_processed_reference
         FROM withdrawal_requests
         WHERE user_id=$1
         ORDER BY id DESC
         LIMIT 10`,
        [userId]
      ),
    ]);
    legacyLedger = {
      goldTransactions: gold.rows,
      checkouts: checkouts.rows,
      wallet: wallet.rows[0] || null,
      walletTransactions: walletTransactions.rows,
      withdrawals: withdrawals.rows,
    };
  }
  console.log(
    JSON.stringify({
      schemaReady: requiredColumns.every((column) => found.has(column)),
      missingColumns: requiredColumns.filter((column) => !found.has(column)),
      payoutSafety: {
        safe: safety.safe,
        environment: safety.environment,
        payoutMode: safety.payoutMode,
        code: safety.code,
      },
      legacyLedger,
    })
  );
};

run()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
