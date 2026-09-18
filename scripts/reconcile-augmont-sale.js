const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env") });

const { pool } = require(path.join(process.cwd(), "dist/config/db"));
const {
  augmontGetSellStatus,
  augmontGetUserBanks,
  augmontGetWithdrawStatus,
} = require(path.join(process.cwd(), "dist/services/augmont.service"));

const transactionId = Number(process.argv[2]);

const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, next]) => [
      key,
      /account.?number|ifsc|token|password|secret/i.test(key)
        ? "[REDACTED]"
        : redact(next),
    ])
  );
};

const main = async () => {
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    throw new Error("Usage: node scripts/reconcile-augmont-sale.js <gold-transaction-id>");
  }

  const result = await pool.query(
    `SELECT gt.id, gt.merchant_txn_id, gt.augmont_txn_id, u.firebase_uid
     FROM gold_transactions gt
     JOIN users u ON u.id=gt.user_id
     WHERE gt.id=$1 AND gt.type='sell'
     LIMIT 1`,
    [transactionId]
  );
  const transaction = result.rows[0];
  if (!transaction) throw new Error("Sell transaction not found");

  const sell = await augmontGetSellStatus(
    transaction.merchant_txn_id,
    transaction.firebase_uid
  );
  const userBanks = await augmontGetUserBanks(transaction.firebase_uid).catch(
    (error) => ({ error: String(error?.message || error) })
  );
  const withdrawCandidates = [
    transaction.augmont_txn_id,
    transaction.merchant_txn_id,
  ].filter(Boolean);
  const withdrawAttempts = [];

  for (const sellTransactionId of [...new Set(withdrawCandidates)]) {
    try {
      const response = await augmontGetWithdrawStatus(
        sellTransactionId,
        transaction.firebase_uid
      );
      withdrawAttempts.push({ sellTransactionId, response });
      break;
    } catch (error) {
      withdrawAttempts.push({
        sellTransactionId,
        error: String(error?.message || error),
      });
    }
  }

  console.log(
    JSON.stringify(
      redact({
        transaction: {
          id: transaction.id,
          merchantTransactionId: transaction.merchant_txn_id,
          augmontTransactionId: transaction.augmont_txn_id,
        },
        sell,
        userBanks,
        withdrawAttempts,
      }),
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
