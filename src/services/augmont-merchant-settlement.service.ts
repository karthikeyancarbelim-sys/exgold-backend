import { PoolClient } from "pg";

export type AugmontMerchantDirection =
  | "payable_to_augmont"
  | "receivable_from_augmont";

type RecordSettlementInput = {
  goldTransactionId: number;
  type: "buy" | "sell";
  amount: number;
};

export const settlementDirection = (type: "buy" | "sell"): AugmontMerchantDirection =>
  type === "buy" ? "payable_to_augmont" : "receivable_from_augmont";

export const settlementAmountResult = (expectedAmount: number, settledAmount: number) => {
  const variance = Number((settledAmount - expectedAmount).toFixed(2));
  return {
    variance,
    status: variance === 0 ? "settled" : "review",
  } as const;
};

export const recordAugmontMerchantSettlement = async (
  client: PoolClient,
  input: RecordSettlementInput
) => {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Augmont merchant settlement requires a positive amount");
  }

  const direction = settlementDirection(input.type);
  const result = await client.query(
    `INSERT INTO augmont_merchant_settlements
       (gold_transaction_id, direction, amount, status, due_date)
     VALUES ($1,$2,$3,'pending',
             (NOW() AT TIME ZONE 'Asia/Kolkata')::date + 1)
     ON CONFLICT (gold_transaction_id) DO UPDATE
       SET amount=CASE
             WHEN augmont_merchant_settlements.status='pending' THEN EXCLUDED.amount
             ELSE augmont_merchant_settlements.amount
           END,
           direction=EXCLUDED.direction,
           updated_at=NOW()
     RETURNING *`,
    [input.goldTransactionId, direction, input.amount]
  );
  return result.rows[0];
};

type CreditSaleInput = {
  transactionId: number;
  userId: number;
  amount: number;
  providerTransactionId?: string;
  providerPayload?: any;
};

export const creditConfirmedMerchantSale = async (
  client: PoolClient,
  input: CreditSaleInput
) => {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Confirmed gold sale amount is invalid");
  }

  const referenceId = `gold_sale:${input.transactionId}`;
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [referenceId]);
  const locked = await client.query(
    `SELECT id, user_id, type, status, gold_restored_at
     FROM gold_transactions WHERE id=$1 FOR UPDATE`,
    [input.transactionId]
  );
  const sale = locked.rows[0];
  if (!sale || sale.type !== "sell" || Number(sale.user_id) !== input.userId) {
    throw new Error("Gold sale was not found");
  }
  if (sale.gold_restored_at) {
    throw new Error("Gold sale was already reversed and cannot be credited");
  }

  await client.query(
    `INSERT INTO wallets (user_id, balance, reserved_balance)
     VALUES ($1,0,0)
     ON CONFLICT (user_id) DO NOTHING`,
    [input.userId]
  );
  const existingCredit = await client.query(
    `SELECT id FROM wallet_transactions
     WHERE reference_id=$1 AND type='credit' AND status='success'
     LIMIT 1 FOR UPDATE`,
    [referenceId]
  );

  if (!existingCredit.rows.length) {
    await client.query(
      `UPDATE wallets SET balance=COALESCE(balance,0)+$1 WHERE user_id=$2`,
      [input.amount, input.userId]
    );
    await client.query(
      `INSERT INTO wallet_transactions
         (user_id, type, amount, method, reason, status, reference_id)
       VALUES ($1,'credit',$2,'augmont_gold_sale',
               'Gold sale credited to ExGold wallet','success',$3)`,
      [input.userId, input.amount, referenceId]
    );
  }

  await client.query(
    `UPDATE gold_transactions
     SET augmont_txn_id=COALESCE(NULLIF($1,''),augmont_txn_id),
         provider_payload=COALESCE($2,provider_payload),
         amount=$3,
         status='success',
         payout_route='exgold_wallet',
         payout_status='wallet_credited',
         payout_reference=$4,
         settled_at=COALESCE(settled_at,NOW())
     WHERE id=$5`,
    [
      input.providerTransactionId || "",
      input.providerPayload || null,
      input.amount,
      referenceId,
      input.transactionId,
    ]
  );
  await recordAugmontMerchantSettlement(client, {
    goldTransactionId: input.transactionId,
    type: "sell",
    amount: input.amount,
  });

  return { alreadyCredited: Boolean(existingCredit.rows.length), referenceId };
};
