const { Pool } = require('pg');
require('dotenv').config();
const { buildAugmontProfile } = require('../dist/utils/augmont-profile');
const apply = process.argv.includes('--apply');
const viaApi = process.argv.includes('--via-api');
let firebase;
const normalizeDbHost = (host = '') => {
  try {
    const hostname = new URL(host.trim()).hostname;
    if (hostname.includes('.apirest.')) {
      const [project, suffix] = hostname.split('.apirest.');
      return `${project}-pooler.${suffix}`;
    }
    return hostname;
  } catch { return host.trim(); }
};
// Use the existing schema without importing startup's automatic DDL migrations.
const pool = new Pool(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('YOUR_PASSWORD') ? {
  connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false },
} : { host: normalizeDbHost(process.env.DB_HOST), user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: Number(process.env.DB_PORT || 5432),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
(async () => {
  if (apply && new URL(process.env.AUGMONT_BASE_URL || '').hostname !== 'uat-api.merchant.augmont.com') {
    throw new Error('Backfill currently permits only Augmont UAT; production requires a reviewed rollout');
  }
  const result = await pool.query(`SELECT u.firebase_uid, u.name AS user_name,
    u.phone AS user_phone, u.email AS user_email, u.dob AS user_dob,
    a.line1 AS address_line1, a.city AS address_city,
    a.state AS address_state, a.pincode AS address_pincode
    FROM users u LEFT JOIN LATERAL (
      SELECT line1, city, state, pincode FROM user_addresses WHERE user_id=u.id
      ORDER BY is_default DESC, updated_at DESC, id DESC LIMIT 1
    ) a ON TRUE WHERE u.firebase_uid IS NOT NULL ORDER BY u.id`);
  const eligible = result.rows.filter(row => buildAugmontProfile(row).missing.length === 0);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', profiles: result.rows.length,
    eligible: eligible.length, incomplete: result.rows.length - eligible.length, kycRequiredForRegistration: false }));
  if (!apply) return;
  let ensureAugmontInvestmentUser;
  let apiKey;
  if (viaApi) {
    firebase = require('../dist/config/firebase').default;
    const config = require('../../../android/app/google-services.json');
    if (config.project_info.project_id !== firebase.app().options.projectId) throw new Error('Firebase project mismatch');
    apiKey = config.client.find(client => client.client_info.android_client_info.package_name === 'in.exgold.app')?.api_key?.[0]?.current_key;
    if (!apiKey) throw new Error('Firebase API key missing');
  } else {
    require.cache[require.resolve('../dist/config/db')] = { exports: { pool } };
    ({ ensureAugmontInvestmentUser } = require('../dist/services/investment-kyc.service'));
  }
  let registered = 0, failed = 0;
  const limitIndex = process.argv.indexOf('--limit');
  const limit = limitIndex < 0 ? eligible.length : Number(process.argv[limitIndex + 1]);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid backfill limit');
  for (const row of eligible.slice(0, limit)) {
    try {
      if (viaApi) {
        const user = await firebase.auth().getUser(row.firebase_uid);
        const { payload } = buildAugmontProfile(row);
        if (user.disabled || user.phoneNumber !== '+91' + payload.mobileNumber) throw new Error('Firebase identity mismatch');
        const customToken = await firebase.auth().createCustomToken(row.firebase_uid);
        const sessionResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(20000),
        });
        const session = await sessionResponse.json();
        if (!sessionResponse.ok || !session.idToken) throw new Error('Firebase authentication failed');
        if ((await firebase.auth().verifyIdToken(session.idToken)).uid !== row.firebase_uid) throw new Error('Session identity mismatch');
        const headers = { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' };
        const lookup = await fetch('https://api.exgold.in/augmont/users/' + encodeURIComponent(row.firebase_uid), {
          headers, redirect: 'error', signal: AbortSignal.timeout(20000),
        });
        const lookupBody = await lookup.json();
        if (!lookup.ok) {
          if (!/user account does not exist|user (?:account )?not found/i.test(String(lookupBody.message || ''))) throw new Error('Provider lookup failed');
          const dob = row.user_dob ? new Date(row.user_dob) : null;
          if (dob && !Number.isNaN(dob.getTime())) payload.dateOfBirth = dob.toISOString().slice(0, 10);
          const response = await fetch('https://api.exgold.in/augmont/users', {
            method: 'POST', headers, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(20000),
          });
          if (!response.ok) throw new Error('Provider registration failed');
          const confirmation = await fetch('https://api.exgold.in/augmont/users/' + encodeURIComponent(row.firebase_uid), {
            headers, redirect: 'error', signal: AbortSignal.timeout(20000),
          });
          if (!confirmation.ok) throw new Error('Provider confirmation failed');
        }
      } else await ensureAugmontInvestmentUser(row.firebase_uid);
      registered++;
    }
    catch (error) {
      failed++;
      const message = String(error.message || '');
      console.log(JSON.stringify({ registration: 'failed', providerStatus: error.status,
        code: error.code, reason: /timeout|timed out/i.test(message) ? 'provider_timeout'
          : /credential|unauthorized|authentication|token/i.test(message) ? 'provider_authentication'
          : /invalid|validation/i.test(message) ? 'provider_validation'
          : /connect|network|ENOTFOUND/i.test(message) ? 'provider_connection' : 'provider_error' }));
    }
  }
  console.log(JSON.stringify({ registeredOrExisting: registered, failed,
    kycApprovalsChanged: 0, financialTransactionsCreated: 0 }));
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error.code || error.message); process.exitCode = 1; })
  .finally(async () => {
    await pool.end();
    if (firebase) await Promise.all(firebase.apps.map(app => app.delete()));
  });
