const assert = require('node:assert/strict');
let response = { data: { goldBalance: 0 } }, failure, calledUid;
class AugmontProviderError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
const mock = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
mock('../dist/config/db', { pool: {} });
mock('../dist/services/augmont.service', { AugmontProviderError,
  augmontGetPassbook: async uid => {
    calledUid = uid;
    if (failure) throw failure;
    return response;
  } });
const { getPassbook } = require('../dist/controllers/augmont.controller');
const run = async () => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await getPassbook({ user: { uid: 'authenticated-owner' }, params: { uniqueId: 'other-user' } }, res);
  assert.equal(calledUid, 'authenticated-owner');
  return res;
};
(async () => {
  assert.deepEqual((await run()).body.data, response);
  failure = new AugmontProviderError('User account does not exist with this details.', 422);
  const missing = await run();
  assert.equal(missing.statusCode, 409);
  assert.equal(missing.body.code, 'AUGMONT_ACCOUNT_REQUIRED');
  assert.equal(missing.body.providerBalanceVerified, false);
  assert.equal(missing.body.data, undefined, 'missing account must not fabricate zero holdings');
  for (const error of [new AugmontProviderError('Invalid request', 422),
    new AugmontProviderError('Unauthorized', 401), new Error('Timeout')]) {
    failure = error;
    const result = await run();
    assert.equal(result.statusCode, 502);
    assert.equal(result.body.code, 'AUGMONT_PASSBOOK_UNAVAILABLE');
  }
  console.log('Passbook: owner scoping, original balance, missing account and upstream failures passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
