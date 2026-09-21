const assert = require('node:assert/strict');
const { getAugmontMoneySafety, getAugmontDirectPayoutSafety } =
  require('../dist/utils/provider-environment');

const original = Object.fromEntries([
  'NODE_ENV', 'AUGMONT_ENVIRONMENT', 'AUGMONT_API_ROOT',
  'AUGMONT_BASE_URL', 'AUGMONT_LOGIN_BASE_URL',
  'AUGMONT_ALLOW_UAT_IN_PRODUCTION', 'AUGMONT_SELL_PAYOUT_MODE',
].map(key => [key, process.env[key]]));

try {
  process.env.NODE_ENV = 'production';
  process.env.AUGMONT_ALLOW_UAT_IN_PRODUCTION = 'true';
  process.env.AUGMONT_ENVIRONMENT = 'live';
  process.env.AUGMONT_API_ROOT = 'https://uat-api.merchant.augmont.com/api';
  delete process.env.AUGMONT_BASE_URL;
  delete process.env.AUGMONT_LOGIN_BASE_URL;
  assert.equal(getAugmontMoneySafety().safe, false);
  assert.equal(getAugmontMoneySafety().environment, 'non_live');

  process.env.AUGMONT_API_ROOT = 'https://api.merchant.augmont.com/api';
  process.env.AUGMONT_BASE_URL = 'https://uat-api.merchant.augmont.com/api/merchant/v1';
  assert.equal(getAugmontMoneySafety().safe, false);
  delete process.env.AUGMONT_BASE_URL;
  assert.equal(getAugmontMoneySafety().safe, true);
  assert.equal(getAugmontDirectPayoutSafety().safe, false);
  process.env.AUGMONT_SELL_PAYOUT_MODE = 'direct_customer';
  assert.equal(getAugmontDirectPayoutSafety().safe, true);
  console.log('Provider environment: UAT override cannot permit live payment; sell payout requires direct-customer mode');
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
