const fs = require('node:fs');
const path = require('node:path');
const admin = require('../dist/config/firebase').default;
const uid = '5TCyBmRko2TT9Wdr3T9Xr1SlI0s1';

// Admin-created sessions test API authentication, not SMS/OTP verification.
(async () => {
  const user = await admin.auth().getUser(uid);
  if (user.disabled || user.phoneNumber !== '+919876543210') {
    throw Object.assign(new Error('Demo identity mismatch'), { code: 'DEMO_IDENTITY_MISMATCH' });
  }
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../../../android/app/google-services.json'), 'utf8'));
  const project = admin.app().options.projectId;
  if (config.project_info.project_id !== project) {
    throw Object.assign(new Error('Firebase project mismatch'), { code: 'PROJECT_MISMATCH' });
  }
  const key = config.client.find(c => c.client_info.android_client_info.package_name === 'in.exgold.app')
    ?.api_key?.[0]?.current_key;
  if (!key) throw Object.assign(new Error('Firebase API key missing'), { code: 'API_KEY_MISSING' });
  const customToken = await admin.auth().createCustomToken(uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    signal: AbortSignal.timeout(20000),
  });
  const session = await response.json();
  if (!response.ok || !session.idToken) {
    throw Object.assign(new Error('Token exchange failed'), { code: session.error?.message || 'TOKEN_EXCHANGE_FAILED' });
  }
  const verified = await admin.auth().verifyIdToken(session.idToken);
  if (verified.uid !== uid) {
    throw Object.assign(new Error('Session identity mismatch'), { code: 'SESSION_IDENTITY_MISMATCH' });
  }
  console.log(JSON.stringify({ test: 'demo_admin_session', result: 'authenticated', otpFlowTested: false }));
  if (process.argv.includes('--repair-address')) {
    const headers = { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' };
    const response = await fetch('https://api.exgold.in/users/addresses', {
      headers, redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    const addresses = await response.json();
    const address = Array.isArray(addresses) && addresses.find(item => item.label === 'UAT Demo - Not Deliverable');
    if (!response.ok || !address?.id) throw new Error('Saved demo address unavailable');
    const saved = await fetch('https://api.exgold.in/users/addresses/' + address.id, {
      method: 'PATCH', headers, body: JSON.stringify(address), redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    const result = await saved.json();
    console.log(JSON.stringify({ repair: 'demo_address', status: saved.status,
      providerAddressPresent: Boolean(result.augmontAddressId), responseKeys: Object.keys(result),
      syncStatus: result.providerPayload?.syncStatus,
      syncError: result.providerPayload?.syncStatus === 'failed' ? String(result.providerPayload.message).slice(0, 500) : undefined }));
    if (!saved.ok) throw new Error('Demo address repair failed');
    if (!result.augmontAddressId) {
      const providerResponse = await fetch('https://api.exgold.in/augmont/users/' + uid + '/address', {
        method: 'POST', headers, body: JSON.stringify({
          name: address.fullName, fullName: address.fullName, mobile: address.mobile,
          mobileNumber: address.mobile, phone: address.mobile,
          address: address.line1, line1: address.line1, line2: address.line2,
          city: address.city, state: address.state, pincode: address.pincode,
          pinCode: address.pincode, country: address.country,
        }), redirect: 'error', signal: AbortSignal.timeout(30000),
      });
      const providerResult = await providerResponse.json();
      console.log(JSON.stringify({ repair: 'provider_address', status: providerResponse.status,
        responseKeys: Object.keys(providerResult),
        error: !providerResponse.ok ? String(providerResult.message || '').slice(0, 900) : undefined }));
    }
  }
  if (process.argv.includes('--setup-demo')) {
    // Explicitly labelled demo data; never change KYC approval or financial balances.
    const call = async (method, endpoint, data) => {
      const result = await fetch('https://api.exgold.in' + endpoint, {
        method, headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data), redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
      const body = await result.json().catch(() => null);
      console.log(JSON.stringify({ setup: endpoint.replace(uid, '{demoUid}'), status: result.status,
        success: result.ok, error: result.ok ? undefined : String(body?.message || 'Request failed').slice(0, 400) }));
      return { ok: result.ok, body };
    };
    const profile = await call('PATCH', '/users/profile', {
      name: 'ExGold Demo Customer', city: 'Coimbatore', dob: '1990-01-01',
    });
    if (!profile.ok) throw new Error('DEMO_PROFILE_SETUP_FAILED');
    const lookup = await call('GET', '/augmont/users/' + uid);
    if (!lookup.ok) {
      const created = await call('POST', '/augmont/users', {
        userName: 'ExGold Demo Customer', mobileNumber: '9876543210',
        userPincode: '641001', dateOfBirth: '1990-01-01',
      });
      if (!created.ok) throw new Error('DEMO_PROVIDER_SETUP_FAILED');
    }
    const addresses = await call('GET', '/users/addresses');
    if (!addresses.ok || !Array.isArray(addresses.body)) throw new Error('DEMO_ADDRESS_LOOKUP_FAILED');
    if (!addresses.body.some(address => address.label === 'UAT Demo - Not Deliverable')) {
      const saved = await call('POST', '/users/addresses', {
        label: 'UAT Demo - Not Deliverable', fullName: 'ExGold Demo Customer',
        mobile: '9876543210', line1: '1 Demo Test Address - Not Deliverable',
        line2: 'Synthetic UAT fixture only', city: 'Coimbatore', state: 'Tamil Nadu',
        pincode: '641001', country: 'India', isDefault: true,
      });
      if (!saved.ok) throw new Error('DEMO_ADDRESS_SETUP_FAILED');
    }
    console.log(JSON.stringify({ setup: 'kyc', result: 'requires_provider_approved_uat_identity',
      fabricatedApproval: false }));
  }
  if (process.argv.includes('--newman')) {
    const newman = require('../../../.artifacts/postman-runtime/node_modules/newman');
    const collection = require(process.argv.includes('--remaining')
      ? './exgold-checklist-remaining.postman_collection.json' : './exgold-demo-readonly.postman_collection.json');
    if (process.argv.includes('--address-only')) collection.item = collection.item.filter(item => item.name.startsWith('Case 35'));
    const addressCase = collection.item.find(item => item.name.startsWith('Case 35'));
    if (addressCase) addressCase.event[0].script.exec.push(
      'pm.test("Saved address exists in Augmont", () => { let count = 0; const walk = (v, depth = 0) => { if (!v || typeof v !== "object" || depth > 6) return; if (Array.isArray(v)) { count += v.length; return; } Object.values(v).forEach(child => walk(child, depth + 1)); }; walk(pm.response.json()); pm.expect(count).to.be.above(0); });');
    const summary = await new Promise((resolve, reject) => newman.run({
      collection,
      environment: { values: [
        { key: 'baseUrl', value: 'https://api.exgold.in', enabled: true },
        { key: 'demoUid', value: uid, enabled: true },
        { key: 'idToken', value: session.idToken, enabled: true },
      ] },
      reporters: [], timeoutRequest: 20000,
    }, (error, result) => error ? reject(error) : resolve(result)));
    const results = summary.run.executions.map(execution => ({
      name: execution.item.name,
      status: execution.response?.code,
      responseSummary: (() => {
        try {
          const body = execution.response.json();
          const arrays = [];
          const visit = (value, depth = 0) => {
            if (!value || typeof value !== 'object' || depth > 6) return;
            if (Array.isArray(value)) { arrays.push(value.length); return; }
            Object.values(value).forEach(child => visit(child, depth + 1));
          };
          visit(body);
          return { arrayCounts: arrays, errorCode: body.success === false ? body.code : undefined };
        } catch { return undefined; }
      })(),
      error: execution.requestError ? 'Request failed' : undefined,
      assertions: (execution.assertions || []).map(assertion => ({
        name: assertion.assertion, passed: !assertion.error,
      })),
    }));
    console.log(JSON.stringify({ runner: 'newman', otpFlowTested: false,
      requests: results, failures: summary.run.failures.length }, null, 2));
    process.exitCode = summary.run.failures.length ? 1 : 0;
    return;
  }
  for (const endpoint of ['/users/profile', '/users/addresses', '/investment/transactions',
    '/augmont/users/' + uid + '/passbook', '/investment/balance']) {
    const result = await fetch('https://api.exgold.in' + endpoint, {
      headers: { Authorization: `Bearer ${session.idToken}` }, redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    const body = await result.json().catch(() => null);
    console.log(JSON.stringify({ endpoint: endpoint.replace(uid, '{demoUid}'),
      status: result.status, success: result.ok, responseKeys: body && !Array.isArray(body) ? Object.keys(body) : [],
      arrayCount: Array.isArray(body) ? body.length : undefined,
      errorCode: !result.ok ? body?.code : undefined,
      errorSummary: !result.ok ? String(body?.message || '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/(token|secret|password|key)\s*[=:]\s*\S+/gi, '$1=[redacted]').slice(0, 250) : undefined }));
  }
})().catch(error => {
  console.error(JSON.stringify({ result: 'blocked', code: error.code || error.name || 'UNKNOWN_ERROR' }));
  process.exitCode = 1;
}).finally(async () => { await Promise.all(admin.apps.map(app => app.delete())); });
