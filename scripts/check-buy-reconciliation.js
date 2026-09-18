const assert = require('node:assert/strict');
const dbPath = require.resolve('../dist/config/db');
const providerEnvPath = require.resolve('../dist/utils/provider-environment');
let pendingRows = [];
const query = async (sql) => {
  if (sql.includes('FROM checkout_intents')) return { rows: pendingRows };
  return { rows: [] };
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query } } };
require.cache[providerEnvPath] = {
  id: providerEnvPath, filename: providerEnvPath, loaded: true,
  exports: { getAugmontMoneySafety: () => ({ safe: true, environment: 'live', code: null, message: null }) },
};
// settleDigitalGoldCheckout itself is exercised by check-digital-gold-checkout.js;
// here we only need to verify the reconciliation sweep finds stuck rows and
// attempts each one, tolerating per-row failure without aborting the batch.
const settlementPath = require.resolve('../dist/services/digital-gold-settlement.service');
delete require.cache[settlementPath];
const attempted = [];
const razorpayPath = require.resolve('../dist/config/razorpay');
require.cache[razorpayPath] = { id: razorpayPath, filename: razorpayPath, loaded: true, exports: { razorpay: {} } };
const augmontServicePath = require.resolve('../dist/services/augmont.service');
require.cache[augmontServicePath] = {
  id: augmontServicePath, filename: augmontServicePath, loaded: true,
  exports: {
    augmontBuyGold: async () => ({}),
    augmontGetBuyStatus: async () => { throw Object.assign(new Error('not found'), { status: 404 }); },
    extractDeep: () => undefined,
    isAugmontMissingResourceError: () => true,
  },
};
const kycServicePath = require.resolve('../dist/services/investment-kyc.service');
require.cache[kycServicePath] = {
  id: kycServicePath, filename: kycServicePath, loaded: true,
  exports: {
    ensureAugmontInvestmentUser: async () => {},
    getInvestmentKycEligibility: async () => ({ approved: true, providerApproved: true, providerStatus: 'approved' }),
    syncApprovedKycToAugmont: async () => {},
  },
};
const settlementServicePath = require.resolve('../dist/services/augmont-merchant-settlement.service');
require.cache[settlementServicePath] = {
  id: settlementServicePath, filename: settlementServicePath, loaded: true,
  exports: { recordAugmontMerchantSettlement: async () => {} },
};
const { reconcilePendingDigitalGoldCheckouts } = require('../dist/services/digital-gold-settlement.service');

(async () => {
  // Scenario 1: no stuck checkouts -> empty result, no work attempted.
  pendingRows = [];
  let results = await reconcilePendingDigitalGoldCheckouts();
  assert.deepEqual(results, []);

  // Scenario 2: a stuck provider_pending checkout is found and an attempt is made
  // (this particular mock's checkout row won't fully resolve since it's missing
  // from checkout_intents' own SELECT ci.* lookup inside settleDigitalGoldCheckout,
  // which is expected -- the point is the sweep finds it and doesn't throw/abort).
  pendingRows = [{ id: 'checkout-stuck-1' }, { id: 'checkout-stuck-2' }];
  results = await reconcilePendingDigitalGoldCheckouts();
  assert.equal(results.length, 2);
  assert.ok(results.every(r => r.success === false));

  console.log('Buy reconciliation sweep: finds stuck provider_pending checkouts and attempts each without aborting the batch');
})().catch(error => { console.error(error); process.exitCode = 1; });
