const assert = require('node:assert/strict');
let rows = [], calls = 0, dbError = false, providerError = false;
const mock = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
mock('../dist/config/db', { pool: { query: async (sql, args) => {
  assert.match(sql, /u\.firebase_uid=\$1 AND gt\.type=\$2/);
  assert.match(sql, /gt\.gold_grams > 0/);
  assert.match(sql, /LOWER\(COALESCE\(gt\.status/);
  assert.deepEqual(args, ['owner', 'buy', 'local-1']);
  if (dbError) throw new Error('database error');
  return { rows };
} } });
mock('../dist/services/augmont.service', { augmontGetBuyInvoice: async id => {
  calls++;
  assert.equal(id, 'AUG-BUY-1');
  if (providerError) throw new Error('Provider unavailable');
  return { data: { invoiceUrl: 'https://example.com/original.pdf' } };
} });
const { getBuyInvoice } = require('../dist/controllers/augmont.controller');
const run = async () => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await getBuyInvoice({ user: { uid: 'owner' }, params: { transactionId: 'local-1' } }, res);
  return res;
};
(async () => {
  assert.equal((await run()).statusCode, 404);
  assert.equal(calls, 0);
  rows = [{ augmont_txn_id: 'AUG-BUY-1' }];
  const success = await run();
  assert.equal(success.body.data.data.invoiceUrl, 'https://example.com/original.pdf');
  assert.equal(calls, 1);
  dbError = true;
  assert.equal((await run()).statusCode, 500);
  assert.equal(calls, 1);
  dbError = false; providerError = true;
  assert.equal((await run()).statusCode, 500);
  console.log('Buy invoice: ownership query, confirmation gating, original response and failure handling passed (offline mocks)');
})().catch(error => { console.error(error); process.exitCode = 1; });
