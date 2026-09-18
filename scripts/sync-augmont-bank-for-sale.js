const path = require("path");
require(path.join(process.cwd(), "node_modules/dotenv")).config();

const { pool } = require(path.join(process.cwd(), "dist/config/db"));
const { ensureAugmontDirectBank } = require(
  path.join(process.cwd(), "dist/services/augmont-bank.service")
);

const saleId = Number(process.env.LEGACY_SALE_ID || 26);

const finish = (code) => setTimeout(() => process.exit(code), 2000);

const run = async () => {
  const result = await pool.query(
    `SELECT gt.user_id, u.firebase_uid
     FROM gold_transactions gt
     JOIN users u ON u.id=gt.user_id
     WHERE gt.id=$1 AND gt.type='sell'
     LIMIT 1`,
    [saleId]
  );
  const sale = result.rows[0];
  if (!sale) throw new Error("Sale anchor not found");

  const bank = await ensureAugmontDirectBank(
    Number(sale.user_id),
    String(sale.firebase_uid)
  );
  console.log(
    JSON.stringify({
      synced: true,
      providerBankReferenceAvailable: Boolean(bank.userBankId),
      verifiedDestinationLast4Available: Boolean(bank.accountLast4),
    })
  );
};

run()
  .then(() => finish(0))
  .catch((error) => {
    console.error(error.message || error);
    finish(1);
  });
