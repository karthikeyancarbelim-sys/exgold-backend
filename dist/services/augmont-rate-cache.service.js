"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sharedAugmontRates = void 0;
const db_1 = require("../config/db");
const refreshMs = 60000;
const validityMs = 15 * 60000;
const lockKey = 2046735912;
let ready = null;
const ensureStore = () => {
    if (!ready) {
        ready = db_1.pool.query(`CREATE TABLE IF NOT EXISTS provider_rate_cache (
      provider TEXT PRIMARY KEY,
      payload JSONB,
      fetched_at TIMESTAMPTZ,
      attempted_at TIMESTAMPTZ NOT NULL
    )`).then(() => undefined).catch((error) => {
            ready = null;
            throw error;
        });
    }
    return ready;
};
// A shared attempt timestamp also limits failed requests across server instances.
const sharedAugmontRates = async (fetchRates, allowStale) => {
    await ensureStore();
    const client = await db_1.pool.connect();
    let locked = false;
    try {
        await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
        locked = true;
        const result = await client.query("SELECT payload, fetched_at, attempted_at FROM provider_rate_cache WHERE provider='augmont'");
        const row = result.rows[0];
        const now = Date.now();
        const age = row?.fetched_at ? now - new Date(row.fetched_at).getTime() : Infinity;
        if (row?.payload && age >= 0 && age < refreshMs)
            return row.payload;
        const attemptedAge = row ? now - new Date(row.attempted_at).getTime() : Infinity;
        if (attemptedAge < refreshMs) {
            if (allowStale && row?.payload && age >= 0 && age < validityMs)
                return row.payload;
            throw new Error("A fresh Augmont quote is unavailable. Retry after the next rate refresh.");
        }
        await client.query(`INSERT INTO provider_rate_cache (provider, attempted_at)
      VALUES ('augmont',NOW()) ON CONFLICT (provider)
      DO UPDATE SET attempted_at=NOW()`);
        try {
            const payload = await fetchRates();
            await client.query(`UPDATE provider_rate_cache SET payload=$1, fetched_at=NOW()
        WHERE provider='augmont'`, [payload]);
            return payload;
        }
        catch (error) {
            const staleAge = row?.fetched_at ? Date.now() - new Date(row.fetched_at).getTime() : Infinity;
            if (allowStale && row?.payload && staleAge >= 0 && staleAge < validityMs)
                return row.payload;
            throw error;
        }
    }
    finally {
        try {
            if (locked)
                await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
        }
        finally {
            client.release();
        }
    }
};
exports.sharedAugmontRates = sharedAugmontRates;
