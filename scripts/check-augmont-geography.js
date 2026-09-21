const assert = require('node:assert/strict');
let stateCalls = 0, cityCalls = 0;
const id = require.resolve('../dist/services/augmont.service');
require.cache[id] = { id, filename: id, loaded: true, exports: {
  augmontGetStates: async () => {
    stateCalls++;
    return { result: { data: [{ id: 'mVqoM9DM', name: 'Tamil Nadu' }], pagination: { hasMore: false } } };
  },
  augmontGetCities: async args => {
    cityCalls++;
    assert.equal(args.stateId, 'mVqoM9DM');
    return { result: { data: [
      { id: 'wrong-state', name: 'Coimbatore', stateId: 'other' },
      { id: 'YO9j0rq3', name: 'Coimbatore', stateId: 'mVqoM9DM' },
    ], pagination: { hasMore: false } } };
  },
} };
const { resolveAugmontGeography } = require('../dist/services/augmont-geography.service');
(async () => {
  assert.deepEqual(await resolveAugmontGeography('Coimbatore', 'Tamil Nadu'), {
    cityId: 'YO9j0rq3', stateId: 'mVqoM9DM',
  });
  await resolveAugmontGeography(' coimbatore ', 'tamil   nadu');
  assert.equal(stateCalls, 1); assert.equal(cityCalls, 1);
  await assert.rejects(resolveAugmontGeography('Unknown city', 'Tamil Nadu'), /valid Augmont city/);
  await assert.rejects(resolveAugmontGeography('Coimbatore', 'Unknown state'), /valid Augmont state/);
  console.log('Augmont geography: official ID mapping, state membership, cache and unknown place rejection passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
