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
let nameLocked = false;
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
  augmontGetUserAddresses: async () => confirmedAddress
    ? { data: [{ userAddressId: 'address-1', address: confirmedAddress }] }
    : { data: [] },
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
    if (nameLocked && payload.userName) {
      throw Object.assign(new Error('The user name can not be changed after kyc approved.'), { status: 422 });
    }
    if (updateFails) throw new Error('Provider update rejected');
  },
  extractDeep: (value, keys) => keys.map(key => value?.data?.[key]).find(v => v != null),
  isAugmontMissingResourceError: error => error.status === 404,
});

const { ensureAugmontInvestmentUser } = require('../dist/services/investment-kyc.service');
(async () => {
  // A successful provider update is authoritative even when UAT's GET user
  // endpoint does not mirror the address immediately.
  await ensureAugmontInvestmentUser('demo-uid', undefined, { requireAddressSync: true });
  assert.equal(updateCount, 1);
  confirmedAddress = '1 Test Street';
  await ensureAugmontInvestmentUser('demo-uid', undefined, { requireAddressSync: true });
  nameLocked = true;
  await ensureAugmontInvestmentUser('demo-uid', undefined, { requireAddressSync: true });
  nameLocked = false;
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
  assert.equal(updateCount, 6);
  context = { ...context, address_line1: '1 Test Street' };
  accountExists = false;
  confirmedAddress = '';
  await ensureAugmontInvestmentUser('demo-uid', undefined, { requireAddressSync: true });
  assert.equal(createCount, 1);
  confirmedAddress = '1 Test Street';
  await ensureAugmontInvestmentUser('demo-uid', undefined, { requireAddressSync: true });
  console.log('Buy address: creation/update require confirmed street; missing and rejected sync block checkout');
})().catch(error => { console.error(error); process.exitCode = 1; });
