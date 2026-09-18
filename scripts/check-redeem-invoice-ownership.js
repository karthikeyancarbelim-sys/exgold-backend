const assert = require('node:assert/strict');
const dbPath = require.resolve('../dist/config/db');
const augmontServicePath = require.resolve('../dist/services/augmont.service');
let ownedRow = null, statements = [];
const query = async (sql, params) => {
  statements.push({ sql, params });
  if (sql.includes('checkout_intents')) return { rows: ownedRow ? [ownedRow] : [], rowCount: ownedRow ? 1 : 0 };
  return { rows: [], rowCount: 0 };
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query } } };
let invoiceCalls = 0;
require.cache[augmontServicePath] = {
  id: augmontServicePath, filename: augmontServicePath, loaded: true,
  exports: {
    augmontGetRedeemInvoice: async (transactionId) => { invoiceCalls++; return { success: true, transactionId }; },
  },
};
const { getRedeemInvoice } = require('../dist/controllers/augmont.controller');
const run = async (transactionId) => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await getRedeemInvoice({ user: { uid: 'user-7' }, params: { transactionId } }, res);
  return res;
};
(async () => {
  // Scenario 1: transaction ID does not belong to any of this user's completed orders -> 404, invoice never fetched.
  ownedRow = null;
  invoiceCalls = 0;
  let response = await run('EXGORD_someoneElsesOrder_1');
  assert.equal(response.statusCode, 404);
  assert.equal(invoiceCalls, 0);
  assert.ok(statements.some(s => s.sql.includes("u.firebase_uid=$1") && s.params[0] === 'user-7'));

  // Scenario 2: transaction ID found among this user's own completed physical-product orders -> invoice fetched.
  ownedRow = { '?column?': 1 };
  invoiceCalls = 0;
  response = await run('EXGORD_myOwnOrder_1');
  assert.equal(response.statusCode, 200);
  assert.equal(invoiceCalls, 1);
  assert.equal(response.body.data.transactionId, 'EXGORD_myOwnOrder_1');

  console.log('Redeem invoice ownership check: cross-user rejection and owned-order pass-through verified');
})().catch(error => { console.error(error); process.exitCode = 1; });
