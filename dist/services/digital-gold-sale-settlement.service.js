"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDigitalGoldSaleReconciliation = exports.reconcilePendingDigitalGoldSales = exports.reconcileDigitalGoldSale = void 0;
const db_1 = require("../config/db");
const augmont_service_1 = require("./augmont.service");
const augmont_payout_1 = require("../utils/augmont-payout");
const provider_payload_1 = require("../utils/provider-payload");
const provider_environment_1 = require("../utils/provider-environment");
const augmont_merchant_settlement_service_1 = require("./augmont-merchant-settlement.service");
const providerTransactionId = (payload) => String((0, augmont_service_1.extractDeep)(payload, ["transactionId", "transaction_id", "txnId", "txn_id", "id"]) ||
    "");
const providerAmount = (payload) => Number((0, augmont_service_1.extractDeep)(payload, ["totalAmount", "total_amount", "amount", "preTaxAmount"]) || 0);
const loadSale = async (input) => {
    const values = [];
    const where = input.transactionId
        ? (values.push(input.transactionId), `gt.id=$${values.length}`)
        : (values.push(String(input.merchantTransactionId || "")), `gt.merchant_txn_id=$${values.length}`);
    const result = await db_1.pool.query(`SELECT gt.*, u.firebase_uid,
            wa.account_number, wa.ifsc, wa.bank_name,
            wa.augmont_user_bank_id
     FROM gold_transactions gt
     JOIN users u ON u.id=gt.user_id
     LEFT JOIN withdrawal_accounts wa ON wa.id=gt.withdrawal_account_id
     WHERE ${where} AND gt.type='sell'
     LIMIT 1`, values);
    return result.rows[0];
};
const withdrawStatus = async (sale, providerId) => {
    const candidates = [...new Set([providerId, sale.augmont_txn_id, sale.merchant_txn_id])]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    for (const sellTransactionId of candidates) {
        try {
            return await (0, augmont_service_1.augmontGetWithdrawStatus)(sellTransactionId, sale.firebase_uid);
        }
        catch (error) {
            if (!(0, augmont_service_1.isAugmontMissingResourceError)(error))
                throw error;
        }
    }
    return null;
};
const reconcileMerchantSale = async (sale) => {
    if (sale.settled_at && String(sale.payout_status || "") === "wallet_credited") {
        return {
            success: true,
            status: "completed",
            amount: Number(sale.amount || 0),
            walletReference: String(sale.payout_reference || `gold_sale:${sale.id}`),
            alreadyProcessed: true,
            message: "Gold sale proceeds were already credited to the ExGold wallet.",
        };
    }
    const sell = await (0, augmont_service_1.augmontGetSellStatus)(sale.merchant_txn_id, sale.firebase_uid);
    const providerId = providerTransactionId(sell) || String(sale.augmont_txn_id || "");
    const amount = providerAmount(sell) || Number(sale.amount || 0);
    const providerSale = (0, augmont_payout_1.augmontSaleState)(sell);
    const snapshot = {
        ...(sale.provider_payload || {}),
        sell: (0, provider_payload_1.redactProviderPayload)(sell),
        settlement: {
            route: "exgold_wallet",
            providerStatus: providerSale.status,
            reconciledAt: new Date().toISOString(),
        },
    };
    if (providerSale.state === "failed") {
        const client = await db_1.pool.connect();
        try {
            await client.query("BEGIN");
            const locked = await client.query(`SELECT user_id, gold_grams, settled_at, gold_restored_at
         FROM gold_transactions WHERE id=$1 FOR UPDATE`, [sale.id]);
            const current = locked.rows[0];
            if (current && !current.settled_at && !current.gold_restored_at) {
                await client.query("UPDATE users SET gold_balance=COALESCE(gold_balance,0)+$1 WHERE id=$2", [Number(current.gold_grams || 0), current.user_id]);
            }
            if (current && !current.settled_at) {
                await client.query(`UPDATE gold_transactions
           SET augmont_txn_id=COALESCE(NULLIF($1,''),augmont_txn_id),
               status='failed', payout_status='sell_rejected',
               gold_restored_at=COALESCE(gold_restored_at,NOW()),
               provider_payload=$2
           WHERE id=$3`, [providerId, snapshot, sale.id]);
            }
            await client.query("COMMIT");
        }
        catch (error) {
            await client.query("ROLLBACK").catch(() => null);
            throw error;
        }
        finally {
            client.release();
        }
        return {
            success: false,
            status: "failed",
            amount,
            message: "Augmont rejected the sale and the reserved gold was restored.",
        };
    }
    if (providerSale.state === "pending" || !Number.isFinite(amount) || amount <= 0) {
        await db_1.pool.query(`UPDATE gold_transactions
       SET augmont_txn_id=COALESCE(NULLIF($1,''),augmont_txn_id),
           amount=CASE WHEN $2 > 0 THEN $2 ELSE amount END,
           status='provider_pending', payout_status='awaiting_sale_confirmation',
           provider_payload=$3
       WHERE id=$4 AND settled_at IS NULL`, [providerId, amount, snapshot, sale.id]);
        return {
            success: false,
            status: "provider_pending",
            amount,
            message: "Augmont sale confirmation is pending; no wallet credit was created.",
        };
    }
    const client = await db_1.pool.connect();
    try {
        await client.query("BEGIN");
        const credit = await (0, augmont_merchant_settlement_service_1.creditConfirmedMerchantSale)(client, {
            transactionId: Number(sale.id),
            userId: Number(sale.user_id),
            amount,
            providerTransactionId: providerId,
            providerPayload: snapshot,
        });
        await client.query("COMMIT");
        return {
            success: true,
            status: "completed",
            amount,
            walletReference: credit.referenceId,
            alreadyProcessed: credit.alreadyCredited,
            message: "Gold sale confirmed and proceeds credited to the ExGold wallet.",
        };
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => null);
        throw error;
    }
    finally {
        client.release();
    }
};
const reconcileDigitalGoldSale = async (input) => {
    const sale = await loadSale(input);
    if (!sale)
        throw new Error("Gold sale not found");
    if (String(sale.payout_route || "") === "exgold_wallet") {
        return reconcileMerchantSale(sale);
    }
    if (String(sale.payout_route || "") === "augmont_direct" &&
        !String(sale.payout_reference || "").trim()) {
        await db_1.pool.query(`UPDATE gold_transactions
       SET payout_route='exgold_wallet',
           payout_status='awaiting_sale_confirmation',
           settled_at=NULL
       WHERE id=$1
         AND payout_route='augmont_direct'
         AND COALESCE(payout_reference,'')=''`, [sale.id]);
        return reconcileMerchantSale({
            ...sale,
            payout_route: "exgold_wallet",
            payout_status: "awaiting_sale_confirmation",
            settled_at: null,
        });
    }
    if (String(sale.payout_route || "") !== "augmont_direct") {
        return {
            success: false,
            status: String(sale.status || "pending"),
            message: "This sale uses the legacy ExGold wallet settlement route",
        };
    }
    if (!sale.withdrawal_account_id || !sale.account_number || !sale.ifsc) {
        throw new Error("The sale is not bound to a verified bank account");
    }
    if (sale.settled_at && String(sale.payout_status || "") === "paid") {
        return {
            success: true,
            status: "completed",
            amount: Number(sale.amount || 0),
            payoutReference: String(sale.payout_reference || ""),
            destinationLast4: (0, provider_payload_1.accountLast4)(sale.account_number),
            message: "Augmont confirmed payment to the verified bank account.",
        };
    }
    const sell = await (0, augmont_service_1.augmontGetSellStatus)(sale.merchant_txn_id, sale.firebase_uid);
    const providerId = providerTransactionId(sell) || String(sale.augmont_txn_id || "");
    const amount = providerAmount(sell) || Number(sale.amount || 0);
    const destination = {
        userBankId: sale.augmont_user_bank_id,
        accountNumber: sale.account_number,
        ifscCode: sale.ifsc,
    };
    const providerSale = (0, augmont_payout_1.augmontSaleState)(sell);
    const sellDestination = (0, augmont_payout_1.augmontDestinationState)(sell, destination);
    const baseSnapshot = {
        ...(sale.provider_payload || {}),
        sell: (0, provider_payload_1.redactProviderPayload)(sell),
        sale: {
            status: providerSale.status,
            reconciledAt: new Date().toISOString(),
        },
    };
    if (providerSale.state === "failed") {
        const client = await db_1.pool.connect();
        try {
            await client.query("BEGIN");
            const locked = await client.query(`SELECT user_id, gold_grams, settled_at, gold_restored_at
         FROM gold_transactions
         WHERE id=$1
         FOR UPDATE`, [sale.id]);
            const current = locked.rows[0];
            if (current && !current.settled_at && !current.gold_restored_at) {
                await client.query("UPDATE users SET gold_balance=COALESCE(gold_balance,0)+$1 WHERE id=$2", [Number(current.gold_grams || 0), current.user_id]);
            }
            if (current && !current.settled_at) {
                await client.query(`UPDATE gold_transactions
           SET augmont_txn_id=COALESCE(NULLIF($1,''),augmont_txn_id),
               amount=CASE WHEN $2 > 0 THEN $2 ELSE amount END,
               status='failed', payout_status='sell_rejected',
               gold_restored_at=COALESCE(gold_restored_at,NOW()),
               provider_payload=$3
           WHERE id=$4`, [providerId, amount, baseSnapshot, sale.id]);
            }
            await client.query("COMMIT");
        }
        catch (error) {
            await client.query("ROLLBACK").catch(() => null);
            throw error;
        }
        finally {
            client.release();
        }
        return {
            success: false,
            status: "failed",
            amount,
            destinationLast4: (0, provider_payload_1.accountLast4)(sale.account_number),
            message: "Augmont rejected the gold sale. The reserved gold was restored.",
        };
    }
    if (providerSale.state === "pending") {
        await db_1.pool.query(`UPDATE gold_transactions
       SET augmont_txn_id=COALESCE(NULLIF($1,''),augmont_txn_id),
           amount=CASE WHEN $2 > 0 THEN $2 ELSE amount END,
           status='provider_pending', payout_status='sale_status_pending',
           provider_payload=$3
       WHERE id=$4 AND settled_at IS NULL`, [providerId, amount, baseSnapshot, sale.id]);
        return {
            success: false,
            status: "provider_pending",
            amount,
            destinationLast4: (0, provider_payload_1.accountLast4)(sale.account_number),
            message: "Augmont is still confirming the gold sale.",
        };
    }
    const withdrawal = providerId ? await withdrawStatus(sale, providerId) : null;
    const payout = (0, augmont_payout_1.augmontWithdrawalState)(withdrawal);
    const withdrawalDestination = (0, augmont_payout_1.augmontDestinationState)(withdrawal, destination);
    const destinationStates = [sellDestination, withdrawalDestination];
    const destinationState = destinationStates.includes("mismatch")
        ? "mismatch"
        : destinationStates.includes("match")
            ? "match"
            : "unknown";
    const snapshot = {
        ...baseSnapshot,
        withdrawal: (0, provider_payload_1.redactProviderPayload)(withdrawal),
        payout: {
            route: "augmont_direct",
            destinationLast4: (0, provider_payload_1.accountLast4)(sale.account_number),
            destinationMatched: destinationState === "match",
            destinationState,
            status: payout.status,
            reference: payout.reference || null,
            reconciledAt: new Date().toISOString(),
        },
    };
    if (destinationState === "mismatch") {
        await db_1.pool.query(`UPDATE gold_transactions
       SET augmont_txn_id=COALESCE(NULLIF($1,''),augmont_txn_id),
           amount=CASE WHEN $2 > 0 THEN $2 ELSE amount END,
           status='payout_review', payout_status='destination_mismatch',
           provider_payload=$3
       WHERE id=$4 AND settled_at IS NULL`, [providerId, amount, snapshot, sale.id]);
        return {
            success: false,
            status: "payout_review",
            amount,
            destinationLast4: (0, provider_payload_1.accountLast4)(sale.account_number),
            message: "Augmont has not confirmed the verified bank as the payout destination.",
        };
    }
    if (payout.state === "paid" && destinationState !== "match") {
        await db_1.pool.query(`UPDATE gold_transactions
       SET augmont_txn_id=COALESCE(NULLIF($1,''),augmont_txn_id),
           amount=CASE WHEN $2 > 0 THEN $2 ELSE amount END,
           status='payout_review', payout_status='destination_unconfirmed',
           payout_reference=COALESCE(NULLIF($3,''),payout_reference),
           provider_payload=$4
       WHERE id=$5 AND settled_at IS NULL`, [providerId, amount, payout.reference, snapshot, sale.id]);
        return {
            success: false,
            status: "payout_review",
            amount,
            destinationLast4: (0, provider_payload_1.accountLast4)(sale.account_number),
            message: "Augmont reported a payout, but the destination bank needs review.",
        };
    }
    if (payout.state === "paid") {
        await db_1.pool.query(`UPDATE gold_transactions
       SET augmont_txn_id=COALESCE(NULLIF($1,''),augmont_txn_id),
           amount=CASE WHEN $2 > 0 THEN $2 ELSE amount END,
           status='success', payout_status='paid', payout_reference=$3,
           provider_payload=$4, settled_at=COALESCE(settled_at,NOW())
       WHERE id=$5 AND settled_at IS NULL`, [providerId, amount, payout.reference, snapshot, sale.id]);
        return {
            success: true,
            status: "completed",
            amount,
            payoutReference: payout.reference,
            destinationLast4: (0, provider_payload_1.accountLast4)(sale.account_number),
            message: "Augmont confirmed payment to the verified bank account.",
        };
    }
    const status = payout.state === "failed" ? "payout_failed" : "payout_pending";
    await db_1.pool.query(`UPDATE gold_transactions
     SET augmont_txn_id=COALESCE(NULLIF($1,''),augmont_txn_id),
         amount=CASE WHEN $2 > 0 THEN $2 ELSE amount END,
         status=$3, payout_status=$4,
         payout_reference=COALESCE(NULLIF($5,''),payout_reference),
         provider_payload=$6
     WHERE id=$7 AND settled_at IS NULL`, [providerId, amount, status, payout.status, payout.reference, snapshot, sale.id]);
    return {
        success: false,
        status,
        amount,
        destinationLast4: (0, provider_payload_1.accountLast4)(sale.account_number),
        message: payout.state === "failed"
            ? "Augmont reported that the bank payout failed. Support reconciliation is required."
            : "Gold was sold. Augmont bank payout confirmation is pending.",
    };
};
exports.reconcileDigitalGoldSale = reconcileDigitalGoldSale;
const reconcilePendingDigitalGoldSales = async ({ userId, limit = 20, } = {}) => {
    if (!(0, provider_environment_1.getAugmontMoneySafety)().safe)
        return [];
    const values = [];
    const userFilter = userId
        ? (values.push(userId), `AND user_id=$${values.length}`)
        : "";
    values.push(Math.max(1, Math.min(Number(limit) || 20, 50)));
    const rows = await db_1.pool.query(`SELECT id
     FROM gold_transactions
     WHERE type='sell'
       AND payout_route IN ('exgold_wallet','augmont_direct')
       AND settled_at IS NULL
       AND status IN ('pending','provider_pending','payout_pending','payout_review','payout_failed')
       ${userFilter}
     ORDER BY created_at ASC
     LIMIT $${values.length}`, values);
    const results = [];
    for (const row of rows.rows) {
        try {
            results.push(await (0, exports.reconcileDigitalGoldSale)({ transactionId: Number(row.id) }));
        }
        catch (error) {
            results.push({
                success: false,
                transactionId: Number(row.id),
                status: "payout_pending",
                message: String(error?.message || error),
            });
        }
    }
    return results;
};
exports.reconcilePendingDigitalGoldSales = reconcilePendingDigitalGoldSales;
let reconciliationTimer = null;
const startDigitalGoldSaleReconciliation = () => {
    if (reconciliationTimer || !(0, provider_environment_1.getAugmontMoneySafety)().safe)
        return;
    const intervalMs = Math.max(Number(process.env.AUGMONT_SALE_RECONCILE_INTERVAL_MS || 120000), 60000);
    const run = () => (0, exports.reconcilePendingDigitalGoldSales)().catch((error) => console.error("AUGMONT SALE RECONCILIATION ERROR:", error?.message || error));
    reconciliationTimer = setInterval(run, intervalMs);
    reconciliationTimer.unref();
    setTimeout(run, 10000).unref();
};
exports.startDigitalGoldSaleReconciliation = startDigitalGoldSaleReconciliation;
