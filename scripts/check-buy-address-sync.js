const assert = require('node:assert/strict');
const mock = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};

let context = {
  user_id: 7,
  firebase_uid: 'demo-uid',
  user_name: 'Demo Buyer',
  user_phone: '9876543210',
  address_line1: '1 Test Street',
  address_city: 'Coimbatore',
  address_state: 'Tamil Nadu',
  address_pincode: '641001',
};
let confirmedAddress = '';
let updateFails = false;
let updateCount = 0;
let accountExists = true;
let createCount = 0;

mock('../dist/config/db', { pool: { query: async (_sql, args) => {
  assert.deepEqual(args, ['demo-uid']);
  return { rows: [context] };
} } });
mock('../dist/services/augmont-geography.service', {
  resolveAugmontGeography: async () => ({ cityId: 11, stateId: 22 }),
});
mock('../dist/services/augmont.service', {
  augmontGetUser: async () => {
    if (!accountExists) throw Object.assign(new Error('missing'), { status: 404 });
    return { data: { userAddress: confirmedAddress } };
  },
  augmontCreateUser: async (_payload) => {
    createCount++;
    accountExists = true;
    return { data: { uniqueId: 'demo-uid' } };
  },
  augmontUpdateUser: async (_id, payload) => {
    updateCount++;
    assert.equal(payload.userAddress, '1 Test Street');
    assert.equal(payload.userCity, 11);
    assert.equal(payload.userState, 22);
    if (updateFails) throw new Error('Provider update rejected');
  },
  extractDeep: (value, keys) => keys.map(key => value?.data?.[key]).find(v => v != null),
  isAugmontMissingResourceError: error => error.status === 404,
});

const { ensureAugmontInvestmentUser } = require('../dist/services/investment-kyc.service');
(async () => {
  await assert.rejects(
    ensureAugmontInvestmentUser('demo-uid', undefined, { requireAddressSync: true }),
    /did not confirm the customer street address/,
  );
  assert.equal(updateCount, 1);
  confirmedAddress = '1 Test Street';
  await ensureAugmontInvestmentUser('demo-uid', undefined, { requireAddressSync: true });
  updateFails = true;
  await assert.rejects(
    ensureAugmontInvestmentUser('demo-uid', undefined, { requireAddressSync: true }),
    /Provider update rejected/,
  );
  updateFails = false;
  context = { ...context, address_line1: '' };
  await assert.rejects(
    ensureAugmontInvestmentUser('demo-uid', undefined, { requireAddressSync: true }),
    /account setup needs address/,
  );
  assert.equal(updateCount, 3);
  context = { ...context, address_line1: '1 Test Street' };
  accountExists = false;
  confirmedAddress = '';
  await assert.rejects(
    ensureAugmontInvestmentUser('demo-uid', undefined, { requireAddressSync: true }),
    /did not confirm the customer street address/,
  );
  assert.equal(createCount, 1);
  confirmedAddress = '1 Test Street';
  await ensureAugmontInvestmentUser('demo-uid', undefined, { requireAddressSync: true });
  console.log('Buy address: creation/update require confirmed street; missing and rejected sync block checkout');
})().catch(error => { console.error(error); process.exitCode = 1; });
