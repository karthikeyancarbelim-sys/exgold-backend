"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDigitalGoldBuyReconciliation = exports.reconcilePendingDigitalGoldCheckouts = exports.settleDigitalGoldCheckout = void 0;
const db_1 = require("../config/db");
const razorpay_1 = require("../config/razorpay");
const augmont_service_1 = require("./augmont.service");
const investment_kyc_service_1 = require("./investment-kyc.service");
const provider_environment_1 = require("../utils/provider-environment");
const augmont_merchant_settlement_service_1 = require("./augmont-merchant-settlement.service");
const augmont_merchant_policy_1 = require("../utils/augmont-merchant-policy");
const augmont_payout_1 = require("../utils/augmont-payout");
const providerKycApprovedStatuses = new Set([
    "approved",
    "verified",
    "completed",
    "complete",
    "full",
    "success",
]);
const settledLocalStatuses = new Set(["success", "completed"]);
const processingLeaseMs = Number(process.env.DIGITAL_GOLD_PROCESSING_LEASE_MS || 120000);
const providerConfirmed = augmont_payout_1.augmontTransactionConfirmed;
const providerGoldGrams = (payload) => Number((0, augmont_service_1.extractDeep)(payload, [
    "goldGrams",
    "gold_grams",
    "goldQuantity",
    "gold_quantity",
    "metalWeight",
    "grams",
    "quantity",
    "qty",
]) || 0);
const providerTransactionId = (payload) => (0, augmont_service_1.extractDeep)(payload, [
    "txnId",
    "transactionId",
    "transaction_id",
    "orderId",
    "order_id",
]);
const publicError = (error) => String(error?.message || "Digital gold provider processing failed").slice(0, 700);
const completedResult = async (intent) => {
    const merchantTransactionId = String(intent.metadata?.merchantTransactionId || "");
    if (!merchantTransactionId)
        return null;
    const transaction = await db_1.pool.query(`SELECT id, amount, gold_grams, status, augmont_txn_id
     FROM gold_transactions
     WHERE merchant_txn_id=$1
     LIMIT 1`, [merchantTransactionId]);
    const row = transaction.rows[0];
    if (!row ||
        !settledLocalStatuses.has(String(row.status || "").toLowerCase()) ||
        !row.augmont_txn_id ||
        Number(row.gold_grams || 0) <= 0) {
        return null;
    }
    return {
        success: true,
        status: "completed",
        checkoutId: String(intent.id),
        investmentId: merchantTransactionId,
        goldTransactionId: Number(row.id),
        goldGrams: Number(row.gold_grams),
        amount: Number(row.amount),
        alreadyProcessed: true,
    };
};
const settleDigitalGoldCheckout = async (input) => {
    const initial = await db_1.pool.query(`SELECT ci.*, u.firebase_uid
     FROM checkout_intents ci
     JOIN users u ON u.id=ci.user_id
     WHERE ci.id=$1
     LIMIT 1`, [input.checkoutId]);
    const intent = initial.rows[0];
    if (!intent || intent.purpose !== "digital_gold") {
        throw new Error("Digital gold checkout was not found");
    }
    if (input.expectedFirebaseUid && intent.firebase_uid !== input.expectedFirebaseUid) {
        throw new Error("Digital gold checkout does not belong to this user");
    }
    const completed = await completedResult(intent);
    if (completed)
        return completed;
    const paymentId = String(input.paymentId || intent.razorpay_payment_id || "");
    const orderId = String(input.orderId || intent.razorpay_order_id || "");
    if (!paymentId || !orderId || orderId !== intent.razorpay_order_id) {
        throw new Error("Captured payment details are incomplete");
    }
    const payment = (await razorpay_1.razorpay.payments.fetch(paymentId));
    const expectedAmount = Math.round(Number(intent.amount) * 100);
    if (payment.order_id !== orderId ||
        payment.status !== "captured" ||
        Number(payment.amount) !== expectedAmount ||
        String(payment.currency || "").toUpperCase() !== "INR") {
        throw new Error("Razorpay has not confirmed the exact checkout payment");
    }
    const claim = await db_1.pool.connect();
    try {
        await claim.query("BEGIN");
        const locked = await claim.query(`SELECT ci.*, u.firebase_uid
       FROM checkout_intents ci
       JOIN users u ON u.id=ci.user_id
       WHERE ci.id=$1
       FOR UPDATE OF ci`, [input.checkoutId]);
        const current = locked.rows[0];
        if (!current || current.firebase_uid !== intent.firebase_uid) {
            throw new Error("Digital gold checkout was not found");
        }
        const currentCompleted = await completedResult(current);
        if (currentCompleted) {
            await claim.query("COMMIT");
            return currentCompleted;
        }
        const updatedAt = new Date(current.updated_at || 0).getTime();
        if (current.status === "processing" &&
            Number.isFinite(updatedAt) &&
            Date.now() - updatedAt < processingLeaseMs) {
            await claim.query("COMMIT");
            return {
                success: false,
                status: "processing",
                checkoutId: String(current.id),
            };
        }
        await claim.query(`UPDATE checkout_intents
       SET status='processing',
           razorpay_payment_id=$1,
           error_message=NULL,
           updated_at=NOW()
       WHERE id=$2`, [paymentId, input.checkoutId]);
        await claim.query("COMMIT");
    }
    catch (error) {
        await claim.query("ROLLBACK").catch(() => null);
        throw error;
    }
    finally {
        claim.release();
    }
    // Serializes concurrent settlement attempts for the same user across separate
    // checkouts: without this, two checkouts each individually under the KYC-free
    // threshold could both compute a financial-year total that doesn't yet include
    // the other (each intent only reaches status='processing' after its own slow
    // razorpay.payments.fetch call above), letting a combined total over the
    // threshold slip through with KYC never checked for either leg. A session-level
    // advisory lock on a dedicated connection (not tied to any one transaction)
    // holds across the FY-total check, the KYC decision and the Augmont buy call.
    const lockClient = await db_1.pool.connect();
    const lockKey = `digital_gold_buy_kyc:${intent.user_id}`;
    await lockClient.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    try {
        const replay = await completedResult(intent);
        if (replay)
            return replay;
        const providerSafety = (0, provider_environment_1.getAugmontMoneySafety)();
        if (!providerSafety.safe) {
            throw new Error(providerSafety.message || "Live gold provider is unavailable");
        }
        await (0, investment_kyc_service_1.ensureAugmontInvestmentUser)(intent.firebase_uid);
        const amountError = (0, augmont_merchant_policy_1.validateBuyAmount)(Number(intent.amount));
        if (amountError)
            throw new Error(amountError);
        const financialYear = await db_1.pool.query(`SELECT COALESCE(SUM(amount),0)::numeric AS total FROM (
         SELECT amount FROM gold_transactions
         WHERE user_id=$1 AND type='buy'
           AND LOWER(COALESCE(status,'')) IN ('success','completed')
           AND COALESCE(settled_at, created_at) >= $2
         UNION ALL
         SELECT ci.amount FROM checkout_intents ci
         WHERE ci.user_id=$1 AND ci.id<>$3 AND ci.purpose='digital_gold'
           AND ci.razorpay_payment_id IS NOT NULL
           AND ci.status IN ('processing','provider_pending')
           AND NOT EXISTS (
             SELECT 1 FROM gold_transactions gt
             WHERE gt.merchant_txn_id=ci.metadata->>'merchantTransactionId'
               AND LOWER(COALESCE(gt.status,'')) IN ('success','completed')
           )
       ) purchases`, [intent.user_id, (0, augmont_merchant_policy_1.indiaFinancialYearStart)(), intent.id]);
        const requiresKyc = intent.metadata?.kycRequired === true ||
            Number(financialYear.rows[0]?.total || 0) + Number(intent.amount) > augmont_merchant_policy_1.augmontMerchantPolicy.kycFinancialYearThreshold;
        if (requiresKyc) {
            let eligibility = await (0, investment_kyc_service_1.getInvestmentKycEligibility)(intent.firebase_uid, {
                refreshProvider: true,
            });
            if (!eligibility.approved || !eligibility.userId) {
                throw new Error(eligibility.message || "Approved KYC is required for this purchase");
            }
            if (!providerKycApprovedStatuses.has(String(eligibility.providerStatus || "").toLowerCase())) {
                await (0, investment_kyc_service_1.syncApprovedKycToAugmont)(eligibility.userId, undefined, { force: true });
                eligibility = await (0, investment_kyc_service_1.getInvestmentKycEligibility)(intent.firebase_uid, {
                    refreshProvider: true,
                });
            }
            if (!eligibility.providerApproved) {
                throw new Error(`Augmont KYC is ${eligibility.providerStatus || "pending"}; the captured payment remains protected for reconciliation`);
            }
        }
        const merchantTransactionId = String(intent.metadata?.merchantTransactionId || "").trim();
        if (!merchantTransactionId)
            throw new Error("Checkout is missing its investment reference");
        let provider = null;
        try {
            provider = await (0, augmont_service_1.augmontGetBuyStatus)(merchantTransactionId, intent.firebase_uid);
        }
        catch (statusError) {
            if (!(0, augmont_service_1.isAugmontMissingResourceError)(statusError))
                throw statusError;
        }
        if (!provider) {
            provider = await (0, augmont_service_1.augmontBuyGold)({
                userId: intent.firebase_uid,
                amount: Number(intent.amount),
                merchantTransactionId,
            });
        }
        const grams = providerGoldGrams(provider);
        const providerTxnId = String(providerTransactionId(provider) || "").trim();
        if (!providerConfirmed(provider) || !providerTxnId || !Number.isFinite(grams) || grams <= 0) {
            throw new Error("Augmont has not confirmed a positive gold quantity yet");
        }
        const settlement = await db_1.pool.connect();
        try {
            await settlement.query("BEGIN");
            const lockedIntent = await settlement.query("SELECT * FROM checkout_intents WHERE id=$1 FOR UPDATE", [input.checkoutId]);
            const currentIntent = lockedIntent.rows[0];
            if (!currentIntent)
                throw new Error("Digital gold checkout was not found");
            const existing = await settlement.query("SELECT * FROM gold_transactions WHERE merchant_txn_id=$1 FOR UPDATE", [merchantTransactionId]);
            const existingRow = existing.rows[0];
            const wasSettled = existingRow &&
                settledLocalStatuses.has(String(existingRow.status || "").toLowerCase()) &&
                Number(existingRow.gold_grams || 0) > 0;
            let goldTransactionId;
            if (existingRow) {
                const updated = await settlement.query(`UPDATE gold_transactions
           SET augmont_txn_id=$1,
               provider='augmont',
               provider_payload=$2,
               type='buy',
               amount=$3,
               gold_grams=$4,
               status='success',
               settled_at=COALESCE(settled_at, NOW())
           WHERE id=$5
           RETURNING id`, [providerTxnId, provider, intent.amount, grams, existingRow.id]);
                goldTransactionId = Number(updated.rows[0].id);
            }
            else {
                const inserted = await settlement.query(`INSERT INTO gold_transactions
             (user_id, augmont_txn_id, merchant_txn_id, provider, provider_payload,
              type, amount, gold_grams, status, settled_at)
           VALUES ($1,$2,$3,'augmont',$4,'buy',$5,$6,'success',NOW())
           RETURNING id`, [intent.user_id, providerTxnId, merchantTransactionId, provider, intent.amount, grams]);
                goldTransactionId = Number(inserted.rows[0].id);
            }
            if (!wasSettled) {
                await settlement.query("UPDATE users SET gold_balance=COALESCE(gold_balance,0)+$1 WHERE id=$2", [grams, intent.user_id]);
            }
            await (0, augmont_merchant_settlement_service_1.recordAugmontMerchantSettlement)(settlement, {
                goldTransactionId,
                type: "buy",
                amount: Number(intent.amount),
            });
            await settlement.query(`UPDATE checkout_intents
         SET status='completed',
             razorpay_payment_id=$1,
             provider_payload=$2,
             error_message=NULL,
             updated_at=NOW()
         WHERE id=$3`, [paymentId, provider, input.checkoutId]);
            await settlement.query("COMMIT");
            return {
                success: true,
                status: "completed",
                checkoutId: input.checkoutId,
                investmentId: merchantTransactionId,
                goldTransactionId,
                goldGrams: grams,
                amount: Number(intent.amount),
                alreadyProcessed: Boolean(wasSettled),
            };
        }
        catch (error) {
            await settlement.query("ROLLBACK").catch(() => null);
            throw error;
        }
        finally {
            settlement.release();
        }
    }
    catch (error) {
        await db_1.pool.query(`UPDATE checkout_intents
       SET status='provider_pending',
           razorpay_payment_id=COALESCE(razorpay_payment_id,$1),
           error_message=$2,
           updated_at=NOW()
       WHERE id=$3 AND status <> 'completed'`, [paymentId, publicError(error), input.checkoutId]).catch(() => null);
        throw error;
    }
    finally {
        await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => null);
        lockClient.release();
    }
};
exports.settleDigitalGoldCheckout = settleDigitalGoldCheckout;
// A captured Razorpay payment whose settlement failed (Augmont timeout/5xx, a
// transient KYC re-check hiccup, etc.) lands in checkout_intents.status=
// 'provider_pending' and previously had no automatic retry: the Razorpay webhook
// only fires once, and nothing else re-drove it, so a customer could have money
// captured with no gold and no recovery path short of an admin manually finding
// and re-triggering the specific checkoutId. This mirrors the sell-side
// reconciliation below (reconcilePendingDigitalGoldSales /
// startDigitalGoldSaleReconciliation in digital-gold-sale-settlement.service.ts).
const reconcilePendingDigitalGoldCheckouts = async ({ userId, limit = 20, } = {}) => {
    if (!(0, provider_environment_1.getAugmontMoneySafety)().safe)
        return [];
    const values = [];
    const userFilter = userId
        ? (values.push(userId), `AND user_id=$${values.length}`)
        : "";
    values.push(Math.max(1, Math.min(Number(limit) || 20, 50)));
    const rows = await db_1.pool.query(`SELECT id
     FROM checkout_intents
     WHERE purpose='digital_gold'
       AND status='provider_pending'
       ${userFilter}
     ORDER BY created_at ASC
     LIMIT $${values.length}`, values);
    const results = [];
    for (const row of rows.rows) {
        try {
            results.push(await (0, exports.settleDigitalGoldCheckout)({ checkoutId: String(row.id) }));
        }
        catch (error) {
            results.push({
                success: false,
                status: "processing",
                checkoutId: String(row.id),
                message: String(error?.message || error),
            });
        }
    }
    return results;
};
exports.reconcilePendingDigitalGoldCheckouts = reconcilePendingDigitalGoldCheckouts;
let buyReconciliationTimer = null;
const startDigitalGoldBuyReconciliation = () => {
    if (buyReconciliationTimer || !(0, provider_environment_1.getAugmontMoneySafety)().safe)
        return;
    const intervalMs = Math.max(Number(process.env.AUGMONT_BUY_RECONCILE_INTERVAL_MS || 120000), 60000);
    const run = () => (0, exports.reconcilePendingDigitalGoldCheckouts)().catch((error) => console.error("AUGMONT BUY RECONCILIATION ERROR:", error?.message || error));
    buyReconciliationTimer = setInterval(run, intervalMs);
    buyReconciliationTimer.unref();
    setTimeout(run, 10000).unref();
};
exports.startDigitalGoldBuyReconciliation = startDigitalGoldBuyReconciliation;
