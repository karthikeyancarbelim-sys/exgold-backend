const assert = require('node:assert/strict');
let balance, unlocked, locked, eligibilityCalls, reserved, restored, walletCredits, providerCalls, response, checks, shrink;
const mock = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const query = async (sql, args = []) => {
  if (sql.includes('firebase_uid')) return { rows: [{ id: 7, gold_balance: balance }] };
  if (sql.includes('unlocked_buys')) {
    assert.equal(args[1], 48);
    assert.ok(sql.includes('COALESCE(settled_at, created_at) <= NOW()'));
    checks++;
    return { rows: [{ unlocked_buys: shrink && checks > 1 ? 0 : unlocked, consumed_sells: 0,
      next_locked_buy: locked ? new Date() : null }] };
  }
  if (sql.includes('FROM app_settings')) return { rows: [{ value: {} }] };
  if (sql.includes('SELECT gold_balance')) return { rows: [{ gold_balance: balance }] };
  if (sql.includes('merchant_txn_id=') && sql.trim().startsWith('SELECT')) return { rows: [] };
  if (sql.includes('INSERT INTO gold_transactions')) { reserved++; return { rows: [{ id: 26 }] }; }
  if (sql.includes('UPDATE users SET gold_balance=gold_balance-')) balance -= args[0];
  if (sql.includes('UPDATE users SET gold_balance=COALESCE')) { restored++; balance += args[0]; }
  if (sql.includes('SELECT status, settled_at')) return { rows: [{ status: 'pending', settled_at: null, gold_restored_at: null }] };
  return { rows: [], rowCount: 1 };
};
mock('../dist/config/db', { pool: { query, connect: async () => ({ query, release() {} }) } });
mock('../dist/services/augmont.service', {
  augmontGetRates: async () => ({ gSell: 16000, blockId: 'quote-1' }),
  augmontSellGold: async () => { providerCalls++; return response; },
});
mock('../dist/services/digital-gold-sale-settlement.service', { reconcilePendingDigitalGoldSales: async () => {} });
mock('../dist/services/investment-kyc.service', { getInvestmentKycEligibility: async () => {
  eligibilityCalls++; return { approved: true, providerApproved: true };
} });
mock('../dist/utils/provider-environment', { getAugmontMoneySafety: () => ({ safe: true }) });
mock('../dist/services/augmont-merchant-settlement.service', { creditConfirmedMerchantSale: async () => { walletCredits++; } });
const { sellGoldInvestment } = require('../dist/controllers/investment.controller');
const reset = () => {
  balance = 1; unlocked = 1; locked = false; reserved = restored = walletCredits = providerCalls = eligibilityCalls = checks = 0; shrink = false;
  response = { statusCode: 200, transactionId: 'AUG-SELL-26', status: 'success', amount: 480 };
};
const run = async grams => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await sellGoldInvestment({ user: { uid: 'user-7' }, body: { grams, merchantTransactionId: 'EXG-SELL-26' } }, res);
  return res;
};
(async () => {
  for (const grams of [NaN, Infinity, 0, -1, 0.02961]) {
    reset(); assert.equal((await run(grams)).statusCode, 400); assert.equal(providerCalls, 0);
  }
  reset(); unlocked = 0; locked = true;
  assert.equal((await run(0.03)).body.code, 'SELL_LOCK_PERIOD');
  assert.equal(reserved, 0);
  reset(); assert.equal((await run(2)).statusCode, 400); assert.equal(reserved, 0);
  reset(); balance = unlocked = 100;
  assert.equal((await run(100)).statusCode, 400); assert.equal(providerCalls, 0);
  reset(); shrink = true;
  assert.equal((await run(0.03)).statusCode, 400); assert.equal(reserved, 0);
  reset(); response.status = 'pending';
  assert.equal((await run(0.03)).statusCode, 202);
  assert.equal(walletCredits, 0); assert.equal(restored, 0); assert.equal(reserved, 1);
  reset(); response.status = 'failed';
  assert.equal((await run(0.03)).statusCode, 409);
  assert.equal(walletCredits, 0); assert.equal(restored, 1); assert.equal(balance, 1);
  reset(); const sale = await run(0.03);
  assert.equal(sale.body.status, 'completed');
  assert.equal(sale.body.walletCredit, 480); assert.equal(sale.body.remainingGoldGrams, 0.97);
  assert.equal(walletCredits, 1); assert.equal(restored, 0);
  console.log('Gold sell: 12 offline scenarios passed (precision, over-balance, lock, maximum, reservation recheck, pending, failure and confirmed wallet credit)');
})().catch(error => { console.error(error); process.exitCode = 1; });
