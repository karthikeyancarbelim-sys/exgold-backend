const assert = require('node:assert/strict');

const servicePath = require.resolve('../dist/services/augmont.service');
require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: {
    augmontGetStates: async () => ({
      result: { data: [{ id: 'TN', name: 'Tamil Nadu' }], pagination: { hasMore: false } },
    }),
    augmontGetCities: async () => ({
      result: { data: [{ id: 'CBE', name: 'Coimbatore', stateId: 'TN' }], pagination: { hasMore: false } },
    }),
  },
};

const { resolveAugmontGeography } = require('../dist/services/augmont-geography.service');

(async () => {
  assert.deepEqual(await resolveAugmontGeography('coimbatore', 'tamilnadu'), {
    cityId: 'CBE',
    stateId: 'TN',
  });
  console.log('Augmont geography aliases: Tamilnadu and Coimbatore resolve to provider master-data IDs');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
