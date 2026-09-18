const assert = require('node:assert/strict');
const dbPath = require.resolve('../dist/config/db');
let row = null;
let now = Date.parse('2026-09-18T05:00:00Z');
let calls = 0;
let releases = 0;
let unlocks = 0;
const originalNow = Date.now;
Date.now = () => now;
let queue = Promise.resolve();
const pool = {
  query: async () => ({ rows: [] }),
  connect: async () => {
    let releaseLock;
    return {
      query: async (sql, args) => {
        if (sql.includes('pg_advisory_lock(')) {
          const before = queue;
          queue = new Promise(resolve => { releaseLock = resolve; });
          await before;
        } else if (sql.includes('pg_advisory_unlock(')) {
          unlocks++;
          releaseLock();
        } else if (sql.startsWith('SELECT payload')) {
          return { rows: row ? [{ ...row }] : [] };
        } else if (sql.includes('INSERT INTO provider_rate_cache')) {
          row = { ...row, attempted_at: new Date(now) };
        } else if (sql.includes('UPDATE provider_rate_cache')) {
          row = { ...row, payload: args[0], fetched_at: new Date(now) };
        }
        return { rows: [] };
      },
      release: () => { releases++; },
    };
  },
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } };
const { sharedAugmontRates } = require('../dist/services/augmont-rate-cache.service');
const fetchRates = async () => {
  calls++;
  return { blockId: `quote-${calls}`, gBuy: 16115.25, gSell: 15600.75 };
};
(async () => {
  const first = await sharedAugmontRates(fetchRates, false);
  await Promise.all(Array.from({ length: 20 }, () => sharedAugmontRates(fetchRates, false)));
  assert.equal(calls, 1, 'concurrent callers must share one provider quote');
  now += 60_000;
  const second = await sharedAugmontRates(fetchRates, false);
  assert.notEqual(first.blockId, second.blockId);
  assert.equal(calls, 2, 'refresh at exactly one minute');
  now += 60_000;
  const failedFetch = async () => { calls++; throw new Error('provider unavailable'); };
  assert.deepEqual(await sharedAugmontRates(failedFetch, true), second);
  await assert.rejects(sharedAugmontRates(failedFetch, false), /fresh Augmont quote/);
  assert.equal(calls, 3, 'failed requests must also be throttled');
  now = new Date(row.fetched_at).getTime() + 15 * 60_000;
  await assert.rejects(sharedAugmontRates(failedFetch, true), /provider unavailable/);
  now += 1_000;
  await assert.rejects(sharedAugmontRates(failedFetch, true), /fresh Augmont quote/);
  assert.equal(releases, unlocks, 'all connections and locks released');
  console.log('Augmont shared rate cache: concurrent refresh, failure throttle and 15-minute expiry passed (offline mocks)');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Date.now = originalNow; });
