const path = require("path");
require(path.join(process.cwd(), "node_modules/dotenv")).config();

const { Pool } = require(path.join(process.cwd(), "node_modules/pg"));

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
    ? { connectionString: databaseUrl, ssl: { rejectUnauthorized: false } }
    : {
        user: process.env.DB_USER,
        host: normalizeDbHost(process.env.DB_HOST || ""),
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: Number(process.env.DB_PORT || 5432),
        ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      }
);

const buyId = Number(process.env.LEGACY_BUY_ID || 25);
const saleId = Number(process.env.LEGACY_SALE_ID || 26);

const run = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const records = await client.query(
      `SELECT id, user_id, type, status, amount, gold_grams, payout_route
       FROM gold_transactions
       WHERE id = ANY($1::int[])
       ORDER BY id
       FOR UPDATE`,
      [[buyId, saleId]]
    );
    const buy = records.rows.find((row) => Number(row.id) === buyId);
    const sale = records.rows.find((row) => Number(row.id) === saleId);
    if (
      !buy ||
      !sale ||
      buy.type !== "buy" ||
      sale.type !== "sell" ||
      Number(buy.user_id) !== Number(sale.user_id) ||
      Number(buy.gold_grams) !== Number(sale.gold_grams)
    ) {
      throw new Error("Legacy UAT investment pair did not match the expected records");
    }

    const checkout = await client.query(
      `SELECT id
       FROM checkout_intents
       WHERE user_id=$1
         AND purpose='digital_gold'
         AND status='completed'
         AND amount=$2
         AND razorpay_payment_id IS NOT NULL
       LIMIT 1`,
      [buy.user_id, buy.amount]
    );
    if (!checkout.rows.length) {
      throw new Error("Captured checkout evidence was not found for the legacy buy");
    }

    const buyUpdate = await client.query(
      `UPDATE gold_transactions
       SET status='provider_review',
           provider_payload=COALESCE(provider_payload,'{}'::jsonb) ||
             jsonb_build_object('reconciliation',jsonb_build_object(
               'code','AUGMONT_UAT_NOT_LIVE',
               'reviewedAt',NOW()
             ))
       WHERE id=$1 AND status IN ('success','completed')`,
      [buyId]
    );
    const saleUpdate = await client.query(
      `UPDATE gold_transactions
       SET status='payout_review',
           payout_route='legacy_wallet',
           payout_status='uat_unpaid',
           provider_payload=COALESCE(provider_payload,'{}'::jsonb) ||
             jsonb_build_object('reconciliation',jsonb_build_object(
               'code','AUGMONT_UAT_NO_REAL_PAYOUT',
               'reviewedAt',NOW()
             ))
       WHERE id=$1
         AND status IN ('success','completed')
         AND payout_route IS NULL`,
      [saleId]
    );

    await client.query(
      `INSERT INTO admin_audit_logs
       (action, entity_type, entity_id, actor, metadata)
       VALUES ('legacy_uat_investment_review','gold_transaction_pair',$1,
               'codex_reconciliation',$2)`,
      [
        `${buyId}:${saleId}`,
        {
          buyId,
          saleId,
          buyRowsUpdated: buyUpdate.rowCount,
          saleRowsUpdated: saleUpdate.rowCount,
          walletChanged: false,
          withdrawalChanged: false,
        },
      ]
    );
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        reviewed: true,
        buyRowsUpdated: buyUpdate.rowCount,
        saleRowsUpdated: saleUpdate.rowCount,
        walletChanged: false,
        withdrawalChanged: false,
      })
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
};

run()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
