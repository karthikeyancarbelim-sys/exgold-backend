import { Response } from "express";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";
import {
  augmontGetRates,
  augmontSellGold,
} from "../services/augmont.service";
import {
  reconcilePendingDigitalGoldSales,
} from "../services/digital-gold-sale-settlement.service";
import { creditConfirmedMerchantSale } from "../services/augmont-merchant-settlement.service";
import {
  getInvestmentKycEligibility,
  InvestmentKycEligibility,
} from "../services/investment-kyc.service";
import { getAugmontMoneySafety } from "../utils/provider-environment";
import { redactProviderPayload } from "../utils/provider-payload";
import { goldHistoryDetails } from "../utils/gold-history";
import { augmontSaleState, augmontTransactionConfirmed } from "../utils/augmont-payout";
import {
  augmontMerchantPolicy,
  indiaFinancialYearStart,
  roundGold,
  roundMoney,
  validateSellQuantity,
} from "../utils/augmont-merchant-policy";

const confirmedStatuses = ["success", "completed", "complete", "confirmed", "approved"];

const extractDeep = (value: any, keys: string[]): any => {
  if (!value || typeof value !== "object") return undefined;

  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }

  for (const nestedKey of ["data", "result", "response", "transaction", "rates"]) {
    const nested = value[nestedKey];
    if (nested && typeof nested === "object") {
      const found = extractDeep(nested, keys);
      if (found !== undefined && found !== null) return found;
    }
  }

  return undefined;
};

const providerTxnId = (payload: any) =>
  extractDeep(payload, ["txnId", "transactionId", "transaction_id", "id", "orderId", "order_id"]);

const isProviderSuccess = augmontTransactionConfirmed;

const providerAmount = (payload: any) =>
  Number(extractDeep(payload, ["amount", "totalAmount", "total_amount", "preTaxAmount"]) || 0);

const merchantTxnId = (prefix: string, userId: number) => `${prefix}_${userId}_${Date.now()}`;

const getUser = async (uid: string) => {
  const result = await pool.query(
    "SELECT id, kyc_status, gold_balance FROM users WHERE firebase_uid=$1",
    [uid]
  );
  return result.rows[0];
};

const kycBlockStatus = (eligibility: InvestmentKycEligibility) =>
  eligibility.code === "kyc_required" || eligibility.code === "kyc_expired" ? 403 : 409;

const kycBlockPayload = (eligibility: InvestmentKycEligibility) => ({
  success: false,
  code: eligibility.code,
  message: eligibility.message,
  action: "complete_kyc",
  kycStatus: eligibility.localStatus,
  investmentKycStatus: eligibility.approved ? "approved" : eligibility.code,
  providerKycStatus: eligibility.providerStatus,
});

const getInvestmentSettings = async () => {
  const result = await pool.query("SELECT value FROM app_settings WHERE key='withdrawal'");
  const value = result.rows[0]?.value || {};
  return {
    goldBuyEnabled: value.goldBuyEnabled !== false,
    goldSellEnabled: value.goldSellEnabled !== false,
    minimumBuyAmount: augmontMerchantPolicy.minimumBuyAmount,
    maximumBuyAmount: augmontMerchantPolicy.maximumBuyAmount,
    maximumSellAmount: augmontMerchantPolicy.maximumSellAmount,
    kycFinancialYearThreshold: augmontMerchantPolicy.kycFinancialYearThreshold,
    sellLockHours: augmontMerchantPolicy.sellLockHours,
    buyTaxRate: Number(process.env.AUGMONT_GOLD_TAX_RATE || 3),
  };
};

const financialYearBuyTotal = async (userId: number) => {
  const result = await pool.query(
    `SELECT COALESCE(SUM(amount),0)::numeric AS total
     FROM gold_transactions
     WHERE user_id=$1 AND type='buy'
       AND LOWER(COALESCE(status,'')) IN ('success','completed')
       AND COALESCE(settled_at, created_at) >= $2`,
    [userId, indiaFinancialYearStart()]
  );
  return roundMoney(Number(result.rows[0]?.total || 0));
};

const sellableGold = async (userId: number, availableGold: number, db: Pick<typeof pool, "query"> = pool) => {
  const result = await db.query(
    `SELECT
       COALESCE(SUM(gold_grams) FILTER (
         WHERE type='buy'
           AND LOWER(COALESCE(status,'')) IN ('success','completed')
           AND COALESCE(settled_at, created_at) <= NOW() - ($2::text || ' hours')::interval
       ),0)::numeric AS unlocked_buys,
       COALESCE(SUM(gold_grams) FILTER (
         WHERE type='sell'
           AND LOWER(COALESCE(status,'')) NOT IN ('failed','rejected','cancelled','canceled')
           AND gold_restored_at IS NULL
       ),0)::numeric AS consumed_sells,
       MIN(COALESCE(settled_at, created_at)) FILTER (
         WHERE type='buy'
           AND LOWER(COALESCE(status,'')) IN ('success','completed')
           AND COALESCE(settled_at, created_at) > NOW() - ($2::text || ' hours')::interval
       ) AS next_locked_buy
     FROM gold_transactions WHERE user_id=$1`,
    [userId, augmontMerchantPolicy.sellLockHours]
  );
  const row = result.rows[0] || {};
  const unlocked = Math.max(Number(row.unlocked_buys || 0) - Number(row.consumed_sells || 0), 0);
  const sellable = Math.min(Math.max(availableGold, 0), unlocked);
  const nextLockedBuy = row.next_locked_buy ? new Date(row.next_locked_buy) : null;
  return {
    sellableGoldGrams: roundGold(sellable),
    lockedGoldGrams: roundGold(Math.max(availableGold - sellable, 0)),
    sellUnlockAt: nextLockedBuy
      ? new Date(nextLockedBuy.getTime() + augmontMerchantPolicy.sellLockHours * 3600000).toISOString()
      : null,
  };
};

export const getInvestmentStatus = async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.user.uid);
    if (!user) return res.status(404).json({ message: "User not found" });
    const settings = await getInvestmentSettings();
    const eligibility = await getInvestmentKycEligibility(req.user.uid, {
      refreshProvider: true,
    });
    const providerSafety = getAugmontMoneySafety();
    const investmentKycApproved = eligibility.approved && eligibility.providerApproved;
    const fyBuyTotal = await financialYearBuyTotal(Number(user.id));
    const kycFreePurchaseRemaining = Math.max(
      settings.kycFinancialYearThreshold - fyBuyTotal,
      0
    );
    const buyRequiresKyc = kycFreePurchaseRemaining < settings.minimumBuyAmount;
    const buyEnabled = providerSafety.safe && settings.goldBuyEnabled &&
      (!buyRequiresKyc || investmentKycApproved);
    const sellEnabled =
      providerSafety.safe && settings.goldSellEnabled && investmentKycApproved;

    return res.json({
      enabled: true,
      kycStatus: eligibility.localStatus || user.kyc_status || "none",
      kycApproved: eligibility.localApproved,
      buyRequiresKyc,
      sellRequiresKyc: true,
      investmentKycStatus: investmentKycApproved
        ? "approved"
        : eligibility.approved
          ? "provider_kyc_pending"
          : eligibility.code,
      providerKycStatus: eligibility.providerStatus,
      kycExpiresAt: eligibility.expiresAt,
      buyEnabled,
      sellEnabled,
      providerReady: providerSafety.safe,
      sellProviderReady: providerSafety.safe,
      providerEnvironment: providerSafety.environment,
      buyBlockReason: !providerSafety.safe
        ? providerSafety.message
        : settings.goldBuyEnabled
        ? buyRequiresKyc && !investmentKycApproved
          ? eligibility.approved
            ? `Augmont KYC is ${eligibility.providerStatus || "pending"}`
            : eligibility.message
          : null
        : "Gold purchase is temporarily paused",
      sellBlockReason: !providerSafety.safe
        ? providerSafety.message
        : settings.goldSellEnabled
        ? investmentKycApproved
          ? null
          : eligibility.approved
            ? `Augmont KYC is ${eligibility.providerStatus || "pending"}`
            : eligibility.message
        : "Gold sale is temporarily paused",
      sipEnabled: false,
      provider: "augmont",
      sellPayoutMode: "exgold_wallet_then_verified_bank",
      financialYearBuyTotal: fyBuyTotal,
      kycFreePurchaseRemaining: roundMoney(kycFreePurchaseRemaining),
      ...settings,
      options: [
        "buy",
        "sell",
        "rates",
        "balance",
        "history",
      ],
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch investment status" });
  }
};

export const getInvestmentRates = async (_req: AuthRequest, res: Response) => {
  try {
    const rates = await augmontGetRates({ allowStale: true });
    return res.json({ success: true, rates });
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "Failed to fetch Augmont rates",
    });
  }
};

export const getGoldBalance = async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.user.uid);
    if (!user) return res.status(404).json({ message: "User not found" });

    const totals = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (
           WHERE type IN ('buy','sip')
             AND status = ANY($2::text[])
             AND gold_grams > 0
         ), 0)::numeric AS confirmed_buy_amount,
         COALESCE(SUM(gold_grams) FILTER (
           WHERE type IN ('buy','sip')
             AND status = ANY($2::text[])
             AND gold_grams > 0
         ), 0)::numeric AS confirmed_buy_grams,
         COALESCE(SUM(gold_grams) FILTER (
           WHERE type='sell'
             AND status = ANY($2::text[])
             AND gold_grams > 0
         ), 0)::numeric AS confirmed_sell_grams,
         COALESCE(SUM(gold_grams) FILTER (
           WHERE type='sell'
              AND status IN (
                'pending','provider_pending','payout_pending',
                'payout_review','payout_failed'
              )
              AND settled_at IS NULL
         ), 0)::numeric AS reserved_sell_grams
       FROM gold_transactions
       WHERE user_id=$1`,
      [user.id, confirmedStatuses]
    );

    const portfolio = totals.rows[0] || {};
    const availableGrams = Math.max(Number(user.gold_balance || 0), 0);
    const saleAvailability = await sellableGold(Number(user.id), availableGrams);
    const boughtGrams = Number(portfolio.confirmed_buy_grams || 0);
    const confirmedBuyAmount = Number(portfolio.confirmed_buy_amount || 0);
    const costPerGram = boughtGrams > 0 ? confirmedBuyAmount / boughtGrams : 0;
    const investedCost = availableGrams > 0 ? availableGrams * costPerGram : 0;
    let sellRate = 0;
    try {
      const rates = await augmontGetRates({ allowStale: true });
      sellRate = Number(
        extractDeep(rates, ["gSell", "goldSell", "gold_sell", "sellRate", "sell_rate"]) || 0
      );
    } catch (error: any) {
      console.warn("AUGMONT PORTFOLIO VALUATION UNAVAILABLE:", error?.message || error);
    }
    const valuationAvailable = Number.isFinite(sellRate) && sellRate > 0;
    const currentValue = valuationAvailable ? availableGrams * sellRate : null;
    return res.json({
      success: true,
      goldGrams: availableGrams,
      availableGoldGrams: availableGrams,
      ...saleAvailability,
      reservedGoldGrams: Number(portfolio.reserved_sell_grams || 0),
      totalBoughtGrams: boughtGrams,
      totalSoldGrams: Number(portfolio.confirmed_sell_grams || 0),
      totalInvested: Number(investedCost.toFixed(2)),
      currentValue: currentValue === null ? null : Number(currentValue.toFixed(2)),
      liveSellRate: valuationAvailable ? sellRate : null,
      valuationAvailable,
      unrealizedPnl:
        currentValue === null ? null : Number((currentValue - investedCost).toFixed(2)),
      provider: "augmont",
      source: "confirmed_transactions",
    });
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "Failed to fetch Augmont balance",
    });
  }
};

// Digital gold is credited only through settleDigitalGoldCheckout after a
// verified Razorpay payment (see payment.controller.ts / digital-gold-settlement.service.ts).
// A direct buy-and-credit endpoint deliberately does not exist here: crediting
// gold from an amount without a verified payment reference would let a caller
// mint gold for free. Do not add a POST /investment/buy handler that calls
// augmontBuyGold and credits gold_balance directly.

export const sellGoldInvestment = async (req: AuthRequest, res: Response) => {
  let merchantTransactionId = "";
  let localTransactionId: number | null = null;
  let localUserId: number | null = null;
  let reservationCreated = false;
  try {
    const providerSafety = getAugmontMoneySafety();
    if (!providerSafety.safe) {
      return res.status(503).json({
        success: false,
        code: providerSafety.code,
        message: providerSafety.message,
      });
    }
    const grams = Number(req.body.grams);
    const quantityError = validateSellQuantity(grams);
    if (quantityError) return res.status(400).json({ message: quantityError });

    const user = await getUser(req.user.uid);
    if (!user) return res.status(404).json({ message: "User not found" });
    localUserId = Number(user.id);

    const availability = await sellableGold(localUserId, Number(user.gold_balance || 0));
    if (grams > availability.sellableGoldGrams + 0.0000001) {
      return res.status(400).json({
        code: "SELL_LOCK_PERIOD",
        message: availability.lockedGoldGrams > 0
          ? `Only ${availability.sellableGoldGrams.toFixed(4)}g is sellable. New purchases are locked for ${augmontMerchantPolicy.sellLockHours} hours.`
          : `Insufficient eligible gold. Available ${availability.sellableGoldGrams.toFixed(4)}g`,
        ...availability,
      });
    }

    const quote = await augmontGetRates({ allowStale: false });
    const liveSellRate = Number(
      extractDeep(quote, ["gSell", "goldSell", "gold_sell", "sellRate", "sell_rate"]) || 0
    );
    if (!Number.isFinite(liveSellRate) || liveSellRate <= 0) {
      return res.status(503).json({ message: "A current Augmont sell quote is unavailable" });
    }
    if (roundMoney(grams * liveSellRate) > augmontMerchantPolicy.maximumSellAmount) {
      return res.status(400).json({
        message: `Maximum gold sale is Rs.${augmontMerchantPolicy.maximumSellAmount.toFixed(0)}`,
      });
    }

    const eligibility = await getInvestmentKycEligibility(req.user.uid, {
      refreshProvider: true,
    });
    if (!eligibility.approved) {
      return res.status(kycBlockStatus(eligibility)).json(kycBlockPayload(eligibility));
    }

    if (!eligibility.providerApproved) {
      return res.status(409).json({
        success: false,
        code: "provider_kyc_pending",
        message: `Augmont KYC is ${eligibility.providerStatus || "pending"}. Selling is unavailable until provider approval.`,
      });
    }

    const settings = await getInvestmentSettings();
    if (!settings.goldSellEnabled) {
      return res.status(403).json({ message: "Gold sell is temporarily paused" });
    }

    merchantTransactionId =
      String(req.body.merchantTransactionId || req.body.merchant_transaction_id || "") ||
      merchantTxnId("EXG_SELL", user.id);
    const duplicate = await pool.query(
      "SELECT * FROM gold_transactions WHERE merchant_txn_id=$1 LIMIT 1",
      [merchantTransactionId]
    );
    if (duplicate.rows.length) {
      const row = duplicate.rows[0];
      if (Number(row.user_id) !== localUserId) return res.status(409).json({ message: "Transaction reference already in use" });
      const complete = confirmedStatuses.includes(String(row.status || "").toLowerCase());
      return res.status(complete ? 200 : 202).json({
        success: complete,
        duplicate: true,
        status: row.status,
        investmentId: row.merchant_txn_id,
        transactionId: row.id,
        transaction: row.provider_payload,
      });
    }
    if (Number(user.gold_balance || 0) < grams) {
      return res.status(400).json({
        message: `Insufficient gold balance. Available ${Number(user.gold_balance || 0).toFixed(4)}g`,
      });
    }
    const reservation = await pool.connect();
    try {
      await reservation.query("BEGIN");
      const existing = await reservation.query(
        "SELECT * FROM gold_transactions WHERE merchant_txn_id=$1 LIMIT 1 FOR UPDATE",
        [merchantTransactionId]
      );
      if (existing.rows.length) {
        if (Number(existing.rows[0].user_id) !== localUserId) {
          await reservation.query("ROLLBACK");
          return res.status(409).json({ message: "Transaction reference already in use" });
        }
        await reservation.query("COMMIT");
        const row = existing.rows[0];
        const complete = confirmedStatuses.includes(String(row.status || "").toLowerCase());
        return res.status(complete ? 200 : 202).json({
          success: complete,
          duplicate: true,
          status: row.status,
          investmentId: row.merchant_txn_id,
          transactionId: row.id,
          transaction: row.provider_payload,
        });
      }

      const lockedUser = await reservation.query(
        "SELECT gold_balance FROM users WHERE id=$1 FOR UPDATE",
        [user.id]
      );
      const availableGold = Number(lockedUser.rows[0]?.gold_balance || 0);
      const lockedAvailability = await sellableGold(Number(user.id), availableGold, reservation);
      if (availableGold < grams || lockedAvailability.sellableGoldGrams < grams) {
        await reservation.query("ROLLBACK");
        return res.status(400).json({
          message: `Insufficient eligible gold. Available ${lockedAvailability.sellableGoldGrams.toFixed(4)}g`,
        });
      }

      const inserted = await reservation.query(
        `INSERT INTO gold_transactions
         (user_id, augmont_txn_id, merchant_txn_id, provider, provider_payload,
          type, amount, gold_grams, status, withdrawal_account_id,
          payout_route, payout_status)
         VALUES ($1,NULL,$2,'augmont',$3,'sell',0,$4,'pending',NULL,
                 'exgold_wallet','awaiting_sale_confirmation')
         RETURNING id`,
        [
          user.id,
          merchantTransactionId,
          {
            request: {
              userId: req.user.uid,
              localUserId: user.id,
              grams,
              merchantTransactionId,
              payoutRoute: "exgold_wallet",
            },
          },
          grams,
        ]
      );
      localTransactionId = Number(inserted.rows[0].id);
      await reservation.query(
        "UPDATE users SET gold_balance=gold_balance-$1 WHERE id=$2",
        [grams, user.id]
      );
      await reservation.query("COMMIT");
      reservationCreated = true;
    } catch (error) {
      await reservation.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      reservation.release();
    }

    const augmont = await augmontSellGold({
      userId: req.user.uid,
      grams,
      merchantTransactionId,
    });
    const amount = providerAmount(augmont);
    const augmontTransactionId = providerTxnId(augmont);
    const providerSucceeded = isProviderSuccess(augmont) && Boolean(augmontTransactionId);

    if (!providerSucceeded) {
      if (augmontSaleState(augmont).state !== "failed") {
        await pool.query(
          `UPDATE gold_transactions
           SET augmont_txn_id=$1, provider_payload=$2, amount=$3,
               status='provider_pending', payout_status='sell_status_pending'
           WHERE id=$4 AND settled_at IS NULL`,
          [augmontTransactionId || null, redactProviderPayload(augmont), amount, localTransactionId],
        );
        return res.status(202).json({
          success: false,
          status: "provider_pending",
          investmentId: merchantTransactionId,
          transactionId: localTransactionId,
          message: "Your sale is awaiting Augmont confirmation.",
        });
      }
      const rejected = await pool.connect();
      try {
        await rejected.query("BEGIN");
        const row = await rejected.query(
          `SELECT status, settled_at, gold_restored_at
           FROM gold_transactions WHERE id=$1 FOR UPDATE`,
          [localTransactionId]
        );
        if (row.rows[0] && !row.rows[0].settled_at && !row.rows[0].gold_restored_at) {
          await rejected.query(
            `UPDATE gold_transactions
             SET augmont_txn_id=$1, provider_payload=$2, amount=$3,
                 status='failed', payout_status='sell_rejected',
                 gold_restored_at=NOW()
             WHERE id=$4`,
            [
              augmontTransactionId || null,
              redactProviderPayload(augmont),
              amount,
              localTransactionId,
            ]
          );
          await rejected.query(
            "UPDATE users SET gold_balance=COALESCE(gold_balance,0)+$1 WHERE id=$2",
            [grams, user.id]
          );
        }
        await rejected.query("COMMIT");
      } catch (error) {
        await rejected.query("ROLLBACK").catch(() => null);
        throw error;
      } finally {
        rejected.release();
      }
      return res.status(409).json({ message: "Gold sale was not confirmed. Your gold was restored." });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      await pool.query(
        `UPDATE gold_transactions
         SET augmont_txn_id=$1, provider_payload=$2, status='payout_pending',
             payout_status='amount_pending'
         WHERE id=$3 AND settled_at IS NULL`,
        [augmontTransactionId || null, redactProviderPayload(augmont), localTransactionId]
      );
      return res.status(202).json({
        success: false,
        status: "payout_pending",
        investmentId: merchantTransactionId,
        transactionId: localTransactionId,
        message: "Gold sale was accepted. The amount is being confirmed before wallet credit.",
      });
    }

    const walletCredit = await pool.connect();
    try {
      await walletCredit.query("BEGIN");
      await creditConfirmedMerchantSale(walletCredit, {
        transactionId: Number(localTransactionId),
        userId: Number(user.id),
        amount,
        providerTransactionId: augmontTransactionId,
        providerPayload: redactProviderPayload(augmont),
      });
      await walletCredit.query("COMMIT");
    } catch (error) {
      await walletCredit.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      walletCredit.release();
    }

    const balance = await pool.query("SELECT gold_balance FROM users WHERE id=$1", [user.id]);
    return res.status(200).json({
      success: true,
      status: "completed",
      investmentId: merchantTransactionId,
      transactionId: localTransactionId,
      soldGrams: grams,
      walletCredit: amount,
      remainingGoldGrams: Number(balance.rows[0]?.gold_balance || 0),
      message: "Gold sale confirmed and proceeds credited to your ExGold wallet.",
    });
  } catch (error: any) {
    if (reservationCreated && localTransactionId && localUserId) {
      const definitiveRejection = [400, 401, 403, 404, 422].includes(Number(error.status));
      const failure = await pool.connect();
      try {
        await failure.query("BEGIN");
        const row = await failure.query(
          `SELECT status, settled_at, gold_restored_at, gold_grams
           FROM gold_transactions WHERE id=$1 FOR UPDATE`,
          [localTransactionId]
        );
        if (row.rows[0] && !row.rows[0].settled_at) {
          const currentStatus = String(row.rows[0].status || "pending");
          if (
            definitiveRejection &&
            currentStatus === "pending" &&
            !row.rows[0].gold_restored_at
          ) {
            await failure.query(
              "UPDATE users SET gold_balance=COALESCE(gold_balance,0)+$1 WHERE id=$2",
              [Number(row.rows[0].gold_grams || 0), localUserId]
            );
          }
          await failure.query(
            `UPDATE gold_transactions
             SET status=CASE WHEN status='pending' THEN $1 ELSE status END,
                 payout_status=CASE WHEN status='pending' THEN $2 ELSE payout_status END,
                 gold_restored_at=CASE
                   WHEN status='pending' AND $1='failed' AND gold_restored_at IS NULL
                   THEN NOW()
                   ELSE gold_restored_at
                 END,
                 provider_payload=COALESCE(provider_payload,'{}'::jsonb) || $3::jsonb
             WHERE id=$4`,
            [
              definitiveRejection ? "failed" : "provider_pending",
              definitiveRejection ? "sell_rejected" : "sell_status_pending",
              JSON.stringify({ error: error.message || "Gold sell failed" }),
              localTransactionId,
            ]
          );
        }
        await failure.query("COMMIT");
      } catch {
        await failure.query("ROLLBACK").catch(() => null);
      } finally {
        failure.release();
      }
    }
    return res.status(502).json({
      status: reservationCreated ? "provider_pending" : "failed",
      investmentId: merchantTransactionId || undefined,
      message: reservationCreated
        ? "The sale could not be confirmed immediately. Gold and payout remain protected while Augmont status is checked."
        : error.message || "Gold sell failed",
    });
  }
};

export const startSipInvestment = async (_req: AuthRequest, res: Response) => {
  return res.status(501).json({
    message: "Recurring gold purchases are not available yet",
  });
};

// Physical gold redemption/delivery is not implemented yet (route returns 501).
// Do not wire up a withdraw handler here until delivery settlement exists.

export const getMyGoldTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.user.uid);
    if (user) {
      await reconcilePendingDigitalGoldSales({
        userId: Number(user.id),
        limit: 5,
      }).catch(() => null);
    }
    const result = await pool.query(
      `WITH user_record AS (
         SELECT id FROM users WHERE firebase_uid=$1
       ), activity AS (
         SELECT
           gt.id::text AS id,
           gt.type AS activity_type,
           INITCAP(REPLACE(gt.type, '_', ' ')) AS title,
           gt.status,
           gt.amount,
           gt.gold_grams,
           gt.merchant_txn_id AS reference_id,
           gt.augmont_txn_id AS provider_transaction_id,
           gt.provider_payload AS details,
           gt.created_at
         FROM gold_transactions gt
         WHERE gt.user_id=(SELECT id FROM user_record)
           AND (
             (
               gt.type IN ('buy','sip')
               AND LOWER(COALESCE(gt.status,'')) IN ('success','completed')
               AND COALESCE(gt.gold_grams,0) > 0
               AND COALESCE(gt.augmont_txn_id,'') <> ''
             )
             OR (
               gt.type IN ('sell','withdraw','redeem')
               AND LOWER(COALESCE(gt.status,'')) IN
                 ('pending','processing','provider_pending','payout_pending',
                  'payout_review','payout_failed','success','completed')
               AND COALESCE(gt.gold_grams,0) > 0
             )
           )

         UNION ALL

         SELECT
           ci.id,
           CASE WHEN ci.purpose='physical_product' THEN 'product_order' ELSE 'digital_gold_payment' END,
           CASE WHEN ci.purpose='physical_product'
             THEN 'Physical product order'
             ELSE 'Digital gold payment' END,
           ci.status,
           ci.amount,
           0::numeric,
           ci.razorpay_payment_id,
           NULL::text,
           jsonb_build_object(
             'items', COALESCE(ci.metadata->'items', '[]'::jsonb),
             'provider', ci.provider_payload,
             'error', ci.error_message
           ),
           ci.created_at
         FROM checkout_intents ci
         WHERE ci.user_id=(SELECT id FROM user_record)
           AND (
             (
               ci.purpose='digital_gold'
               AND ci.razorpay_payment_id IS NOT NULL
               AND ci.status IN ('processing','provider_pending')
             )
             OR (
               ci.purpose='physical_product'
               AND (ci.razorpay_payment_id IS NOT NULL OR ci.status='completed')
             )
           )
       )
       SELECT * FROM activity
       ORDER BY created_at DESC`,
      [req.user.uid]
    );

    const rows = result.rows.map(goldHistoryDetails);
    return res.json(rows);
  } catch {
    return res.status(500).json({ message: "Failed to fetch gold transactions" });
  }
};
