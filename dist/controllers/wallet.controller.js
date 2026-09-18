"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWalletHistory = exports.getWallet = void 0;
const db_1 = require("../config/db");
const getWallet = async (req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT u.id,
              u.kyc_status,
              COALESCE(u.gold_balance, 0)::numeric AS gold_balance,
              COALESCE(w.balance, 0)::numeric AS balance,
              COALESCE(w.reserved_balance, 0)::numeric AS reserved_balance,
              EXISTS(
                SELECT 1 FROM withdrawal_accounts wa
                WHERE wa.user_id=u.id
              ) AS has_payout_account,
              EXISTS(
                SELECT 1 FROM withdrawal_accounts wa
                WHERE wa.user_id=u.id
                  AND wa.bank_verified=true
                  AND wa.status='verified'
                  AND wa.bank_verification_status='verified'
              ) AS payout_verified
       FROM users u
       LEFT JOIN wallets w ON w.user_id=u.id
       WHERE u.firebase_uid=$1
       LIMIT 1`, [req.user.uid]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        const settings = await db_1.pool.query("SELECT value FROM app_settings WHERE key='withdrawal' LIMIT 1");
        const rules = settings.rows[0]?.value || {};
        const wallet = result.rows[0];
        return res.json({
            balance: Number(wallet.balance) || 0,
            cashBalance: Number(wallet.balance) || 0,
            reservedBalance: Number(wallet.reserved_balance) || 0,
            goldBalanceGrams: Number(wallet.gold_balance) || 0,
            minimumWithdrawal: Number(rules.minWithdrawal || 100),
            payoutMethods: ["bank"],
            payoutProvider: "manual",
            automatedPayouts: false,
            kycStatus: wallet.kyc_status || "none",
            hasPayoutAccount: Boolean(wallet.has_payout_account),
            payoutVerified: Boolean(wallet.payout_verified),
        });
    }
    catch (error) {
        console.error("GET WALLET ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch wallet" });
    }
};
exports.getWallet = getWallet;
const getWalletHistory = async (req, res) => {
    try {
        const userResult = await db_1.pool.query("SELECT id FROM users WHERE firebase_uid=$1", [req.user.uid]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        const result = await db_1.pool.query(`WITH activity AS (
         SELECT wt.id::text AS id, wt.type,
           CASE
             WHEN wt.method='gold_sale' THEN 'Digital gold sale - wallet credit'
             WHEN wt.method='withdrawal_refund' THEN 'Withdrawal returned to wallet'
             WHEN wt.type='hold' THEN 'Bank payout awaiting transfer'
             WHEN wt.type='withdrawal_release' THEN 'Withdrawal released'
             WHEN wt.type='credit' THEN 'Wallet top-up'
             WHEN wt.method LIKE 'withdrawal_%' THEN 'Wallet withdrawal'
             ELSE INITCAP(REPLACE(wt.type, '_', ' '))
           END AS title,
           wt.amount, wt.method, wt.status, 0::numeric AS gold_grams,
           wt.reference_id, wt.created_at
         FROM wallet_transactions wt WHERE wt.user_id=$1
         UNION ALL
         SELECT gt.id::text, gt.type, INITCAP(REPLACE(gt.type, '_', ' ')),
           gt.amount, gt.provider, gt.status, gt.gold_grams,
           gt.merchant_txn_id, gt.created_at
         FROM gold_transactions gt WHERE gt.user_id=$1
         UNION ALL
         SELECT ci.id,
           CASE WHEN ci.purpose='physical_product' THEN 'product_order' ELSE 'digital_gold_payment' END,
           CASE WHEN ci.purpose='physical_product' THEN 'Physical product order' ELSE 'Digital gold payment' END,
           ci.amount, 'razorpay', ci.status, 0::numeric,
           COALESCE(ci.razorpay_payment_id, ci.razorpay_order_id), ci.created_at
         FROM checkout_intents ci
         WHERE ci.user_id=$1 AND (ci.purpose='physical_product' OR ci.status <> 'completed')
       )
       SELECT * FROM activity ORDER BY created_at DESC`, [userResult.rows[0].id]);
        return res.json(result.rows);
    }
    catch (error) {
        console.error("WALLET HISTORY ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch wallet history" });
    }
};
exports.getWalletHistory = getWalletHistory;
