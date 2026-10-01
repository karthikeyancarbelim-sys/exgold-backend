const assert = require('node:assert/strict');
const { getAugmontMoneySafety, getAugmontDirectPayoutSafety } =
  require('../dist/utils/provider-environment');

const original = Object.fromEntries([
  'NODE_ENV', 'AUGMONT_ENVIRONMENT', 'AUGMONT_API_ROOT',
  'AUGMONT_BASE_URL', 'AUGMONT_LOGIN_BASE_URL',
  'AUGMONT_ALLOW_UAT_IN_PRODUCTION', 'AUGMONT_UAT_TRANSACTIONS_ENABLED',
  'AUGMONT_SELL_PAYOUT_MODE', 'RAZORPAY_KEY_ID',
].map(key => [key, process.env[key]]));

try {
  process.env.NODE_ENV = 'production';
  process.env.AUGMONT_ALLOW_UAT_IN_PRODUCTION = 'true';
  process.env.AUGMONT_ENVIRONMENT = 'live';
  process.env.AUGMONT_API_ROOT = 'https://uat-api.merchant.augmont.com/api';
  process.env.RAZORPAY_KEY_ID = 'rzp_live_example';
  delete process.env.AUGMONT_BASE_URL;
  delete process.env.AUGMONT_LOGIN_BASE_URL;
  assert.equal(getAugmontMoneySafety().safe, false);
  assert.equal(getAugmontMoneySafety().environment, 'non_live');
  assert.equal(getAugmontMoneySafety().code, 'PAYMENT_PROVIDER_ENVIRONMENT_MISMATCH');

  process.env.RAZORPAY_KEY_ID = 'rzp_test_example';
  assert.equal(getAugmontMoneySafety().safe, false);
  assert.equal(getAugmontMoneySafety().code, 'AUGMONT_UAT_TRANSACTIONS_DISABLED');
  process.env.AUGMONT_UAT_TRANSACTIONS_ENABLED = 'true';
  assert.equal(getAugmontMoneySafety().safe, true);
  assert.equal(getAugmontMoneySafety().paymentEnvironment, 'test');

  process.env.AUGMONT_API_ROOT = 'https://api.merchant.augmont.com/api';
  process.env.AUGMONT_BASE_URL = 'https://uat-api.merchant.augmont.com/api/merchant/v1';
  process.env.RAZORPAY_KEY_ID = 'rzp_live_example';
  assert.equal(getAugmontMoneySafety().safe, false);
  delete process.env.AUGMONT_BASE_URL;
  assert.equal(getAugmontMoneySafety().safe, true);
  process.env.RAZORPAY_KEY_ID = 'rzp_test_example';
  assert.equal(getAugmontMoneySafety().safe, false);
  assert.equal(getAugmontMoneySafety().code, 'PAYMENT_PROVIDER_ENVIRONMENT_MISMATCH');
  process.env.RAZORPAY_KEY_ID = 'rzp_live_example';
  assert.equal(getAugmontDirectPayoutSafety().safe, false);
  process.env.AUGMONT_SELL_PAYOUT_MODE = 'direct_customer';
  assert.equal(getAugmontDirectPayoutSafety().safe, true);
  console.log('Provider environment: live/live and explicit UAT/test pairs pass; mixed pairs fail; live sell payout requires direct-customer mode');
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
