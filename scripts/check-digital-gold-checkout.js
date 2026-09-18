const assert = require('node:assert/strict');
const { readDeep } = require('../dist/utils/provider-payload');
let intent, payment, transaction, credits, buys, yearTotal, statusResponse, buyResponse, eligibility;
const mock = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const query = async (sql, args = []) => {
  if (sql.includes('SELECT ci.*') || sql.includes('SELECT * FROM checkout_intents')) return { rows: [intent] };
  if (sql.includes('FROM gold_transactions') && sql.includes('SUM(amount)')) return { rows: [{ total: yearTotal }] };
  if (sql.includes('FROM gold_transactions') && sql.trim().startsWith('SELECT')) return { rows: transaction ? [transaction] : [] };
  if (sql.includes('INSERT INTO gold_transactions')) {
    transaction = { id: 37, amount: args[4], gold_grams: args[5], status: 'success', augmont_txn_id: args[1] };
    return { rows: [{ id: 37 }] };
  }
  if (sql.includes('UPDATE users SET gold_balance')) credits++;
  if (sql.includes("SET status='processing'")) intent.status = 'processing';
  if (sql.includes("SET status='completed'")) intent.status = 'completed';
  if (sql.includes("SET status='provider_pending'")) intent.status = 'provider_pending';
  return { rows: [], rowCount: 1 };
};
mock('../dist/config/db', { pool: { query, connect: async () => ({ query, release() {} }) } });
mock('../dist/config/razorpay', { razorpay: { payments: { fetch: async () => payment } } });
mock('../dist/services/augmont.service', {
  extractDeep: readDeep,
  isAugmontMissingResourceError: error => error.status === 404,
  augmontGetBuyStatus: async () => {
    if (statusResponse) return statusResponse;
    throw Object.assign(new Error('not found'), { status: 404 });
  },
  augmontBuyGold: async () => { buys++; return buyResponse; },
});
mock('../dist/services/investment-kyc.service', {
  ensureAugmontInvestmentUser: async () => {},
  getInvestmentKycEligibility: async () => eligibility,
  syncApprovedKycToAugmont: async () => {},
});
mock('../dist/utils/provider-environment', { getAugmontMoneySafety: () => ({ safe: true }) });
mock('../dist/services/augmont-merchant-settlement.service', { recordAugmontMerchantSettlement: async () => {} });
const { settleDigitalGoldCheckout } = require('../dist/services/digital-gold-settlement.service');
const reset = () => {
  intent = { id: 'checkout-1', purpose: 'digital_gold', user_id: 7, firebase_uid: 'user-7',
    amount: 500, razorpay_order_id: 'order-1', razorpay_payment_id: 'payment-1',
    metadata: { merchantTransactionId: 'EXG-BUY-1' }, status: 'created' };
  payment = { order_id: 'order-1', amount: 50000, currency: 'INR', status: 'captured' };
  transaction = null; credits = 0; buys = 0; yearTotal = 0; statusResponse = null;
  buyResponse = { statusCode: 200, data: { transactionId: 'AUG-BUY-1', quantity: 0.0296 } };
  eligibility = { approved: false, providerApproved: false, message: 'Complete KYC', userId: 7 };
};
const settle = () => settleDigitalGoldCheckout({ checkoutId: 'checkout-1', expectedFirebaseUid: 'user-7' });
(async () => {
  for (const changes of [{ status: 'authorized' }, { amount: 49900 }, { order_id: 'other' }, { currency: 'USD' }]) {
    reset(); Object.assign(payment, changes);
    await assert.rejects(settle(), /exact checkout payment/);
    assert.equal(buys, 0); assert.equal(credits, 0);
  }
  reset();
  await assert.rejects(settleDigitalGoldCheckout({ checkoutId: 'checkout-1', expectedFirebaseUid: 'other' }), /does not belong/);
  reset();
  const result = await settle();
  assert.equal(result.status, 'completed');
  assert.equal(result.investmentId, 'EXG-BUY-1');
  assert.equal(result.goldGrams, 0.0296);
  assert.equal(credits, 1); assert.equal(buys, 1);
  assert.equal((await settle()).alreadyProcessed, true);
  assert.equal(credits, 1); assert.equal(buys, 1);
  reset();
  yearTotal = 179_500;
  assert.equal((await settle()).status, 'completed', 'exactly Rs.180000 is allowed without KYC');
  assert.equal(buys, 1); assert.equal(credits, 1);
  reset();
  yearTotal = 179_501;
  await assert.rejects(settle(), /Complete KYC/);
  assert.equal(buys, 0); assert.equal(credits, 0);
  assert.equal(intent.status, 'provider_pending');
  reset();
  statusResponse = { statusCode: 200, transactionStatus: 'pending', transactionId: 'AUG-BUY-1', quantity: 0.0296 };
  await assert.rejects(settle(), /not confirmed/);
  assert.equal(buys, 0, 'existing pending provider buy must not be submitted again');
  assert.equal(credits, 0);
  for (const response of [
    { statusCode: 200, status: 'failed', transactionId: 'AUG-BUY-1', quantity: 0.0296 },
    { statusCode: 200, transactionId: 'AUG-BUY-1', quantity: 0 },
  ]) {
    reset(); buyResponse = response;
    await assert.rejects(settle(), /not confirmed/);
    assert.equal(credits, 0);
  }
  console.log('Digital gold checkout: 12 offline scenarios passed (capture validation, ownership, provider confirmation, exact/above KYC threshold, replay and pending retry)');
})().catch(error => { console.error(error); process.exitCode = 1; });
