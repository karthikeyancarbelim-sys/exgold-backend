const assert = require('node:assert/strict');
const dbPath = require.resolve('../dist/config/db');
const bankServicePath = require.resolve('../dist/services/nerotixBank.service');
let sameAccount = [], count = 3, writes = 0, released = 0, statements = [];
const query = async sql => {
  statements.push(sql);
  if (sql.includes('firebase_uid')) return { rows: [{ id: 7 }] };
  if (sql.includes('SELECT id, ifsc')) return { rows: sameAccount };
  if (sql.includes('COUNT(*)')) return { rows: [{ count }] };
  if (sql.includes('INSERT INTO withdrawal_accounts') || sql.includes('UPDATE withdrawal_accounts')) writes++;
  return { rows: [], rowCount: 1 };
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  pool: { query, connect: async () => ({ query, release: () => { released++; } }) },
} };
require.cache[bankServicePath] = { id: bankServicePath, filename: bankServicePath, loaded: true, exports: {
  verifyBankAccountWithNerotix: async () => { throw new Error('Verification must not run on rejected saves'); },
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
  let response = await run();
  assert.equal(response.body.code, 'BANK_ID_LIMIT_REACHED');
  assert.ok(statements.some(sql => sql.includes('FROM users') && sql.includes('FOR UPDATE')));
  assert.ok(statements.includes('ROLLBACK'));
  sameAccount = [{ id: 1, ifsc: 'HDFC0001234', modification_count: 3 }];
  response = await run();
  assert.equal(response.body.code, 'BANK_MODIFICATION_LIMIT_REACHED');
  sameAccount = [{ id: 1, ifsc: 'HDFC0009999', modification_count: 0 }];
  response = await run();
  assert.equal(response.body.code, 'BANK_ACCOUNT_IFSC_MISMATCH');
  response = await run({ ifsc: 'INVALID' });
  assert.equal(response.statusCode, 400);
  assert.equal(writes, 0);
  assert.equal(released, 3);
  console.log('Bank limits: four offline rejection scenarios passed; transaction rollback and lock placement verified');
})().catch(error => { console.error(error); process.exitCode = 1; });
