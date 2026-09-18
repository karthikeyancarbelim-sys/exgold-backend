const assert = require("node:assert/strict");
const {
  creditConfirmedMerchantSale,
  settlementAmountResult,
  settlementDirection,
} = require("../dist/services/augmont-merchant-settlement.service");

assert.equal(settlementDirection("buy"), "payable_to_augmont");
assert.equal(settlementDirection("sell"), "receivable_from_augmont");
assert.deepEqual(settlementAmountResult(500, 500), {
  variance: 0,
  status: "settled",
});
assert.deepEqual(settlementAmountResult(480.86, 480.85), {
  variance: -0.01,
  status: "review",
});
assert.deepEqual(settlementAmountResult(480.86, 481), {
  variance: 0.14,
  status: "review",
});

const fakeClient = (existingCredit) => {
  const statements = [];
  return {
    statements,
    query: async (sql) => {
      statements.push(String(sql));
      if (String(sql).includes("FROM gold_transactions WHERE id=")) {
        return { rows: [{ id: 26, user_id: 7, type: "sell", status: "pending", gold_restored_at: null }] };
      }
      if (String(sql).includes("FROM wallet_transactions")) {
        return { rows: existingCredit ? [{ id: 99 }] : [] };
      }
      if (String(sql).includes("RETURNING *")) {
        return { rows: [{ id: 1, status: "pending" }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
};

(async () => {
  const firstCredit = fakeClient(false);
  await creditConfirmedMerchantSale(firstCredit, {
    transactionId: 26,
    userId: 7,
    amount: 480.86,
    providerTransactionId: "AUG-SELL-26",
  });
  assert.equal(
    firstCredit.statements.filter((sql) => sql.includes("UPDATE wallets SET balance")).length,
    1
  );

  const replay = fakeClient(true);
  const replayResult = await creditConfirmedMerchantSale(replay, {
    transactionId: 26,
    userId: 7,
    amount: 480.86,
    providerTransactionId: "AUG-SELL-26",
  });
  assert.equal(replayResult.alreadyCredited, true);
  assert.equal(
    replay.statements.filter((sql) => sql.includes("UPDATE wallets SET balance")).length,
    0
  );

  console.log("Augmont merchant settlement checks passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
