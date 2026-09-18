const assert = require('node:assert/strict');
const dbPath = require.resolve('../dist/config/db');
const bankServicePath = require.resolve('../dist/services/nerotixBank.service');
let sameAccount = [], otherUserOwns = [], count = 0, writes = 0, released = 0, statements = [];
const query = async sql => {
  statements.push(sql);
  if (sql.includes('firebase_uid')) return { rows: [{ id: 7 }] };
  if (sql.includes('SELECT id, ifsc')) return { rows: sameAccount };
  if (sql.includes('user_id<>')) return { rows: otherUserOwns };
  if (sql.includes('COUNT(*)')) return { rows: [{ count }] };
  if (sql.includes('INSERT INTO withdrawal_accounts') || sql.includes('UPDATE withdrawal_accounts')) writes++;
  return { rows: [], rowCount: 1 };
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  pool: { query, connect: async () => ({ query, release: () => { released++; } }) },
} };
require.cache[bankServicePath] = { id: bankServicePath, filename: bankServicePath, loaded: true, exports: {
  verifyBankAccountWithNerotix: async () => { throw new Error('Verification must not run in this offline test'); },
} };
const { upsertWithdrawalAccount } = require('../dist/controllers/withdrawal.controller');
const run = async (body = {}) => {
  statements = [];
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await upsertWithdrawalAccount({ user: { uid: 'user-7' }, body: {
    accountHolderName: 'Test User', accountNumber: '1234567890', ifsc: 'HDFC0001234', ...body,
  } }, res);
  return res;
};
(async () => {
  // Scenario 1: brand-new account number already registered to a DIFFERENT customer -> must be rejected before any write.
  sameAccount = [];
  otherUserOwns = [{ id: 99 }];
  let response = await run();
  assert.equal(response.body.code, 'BANK_ACCOUNT_ALREADY_REGISTERED');
  assert.equal(writes, 0);
  assert.ok(statements.includes('ROLLBACK'));
  assert.ok(statements.some(sql => sql.includes('user_id<>')));

  // Scenario 2: customer re-saving/updating THEIR OWN existing account -> cross-user lookup must be skipped entirely.
  sameAccount = [{ id: 1, ifsc: 'HDFC0001234', modification_count: 0 }];
  otherUserOwns = [{ id: 99 }]; // would wrongly reject if the guard ran unconditionally
  response = await run();
  assert.notEqual(response.body.code, 'BANK_ACCOUNT_ALREADY_REGISTERED');
  assert.ok(!statements.some(sql => sql.includes('user_id<>')));

  // Scenario 3: brand-new account number nobody else owns -> passes the new guard and reaches the write.
  sameAccount = [];
  otherUserOwns = [];
  writes = 0;
  response = await run();
  assert.notEqual(response.body.code, 'BANK_ACCOUNT_ALREADY_REGISTERED');
  assert.equal(writes, 1);
  assert.ok(statements.some(sql => sql.includes('user_id<>')));

  console.log('Bank cross-user check: rejection, same-user bypass, and new-account pass-through scenarios verified');
})().catch(error => { console.error(error); process.exitCode = 1; });
