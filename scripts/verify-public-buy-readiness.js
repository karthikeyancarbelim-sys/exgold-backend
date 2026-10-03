const fs = require('node:fs');
const path = require('node:path');
const admin = require('../dist/config/firebase').default;

const uid = '5TCyBmRko2TT9Wdr3T9Xr1SlI0s1';
const baseUrl = 'https://api.exgold.in';

const request = async (endpoint, token, options = {}) => {
  const response = await fetch(baseUrl + endpoint, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
};

(async () => {
  const user = await admin.auth().getUser(uid);
  if (user.disabled || user.phoneNumber !== '+919876543210') {
    throw new Error('Demo reviewer identity is unavailable');
  }

  const googleServices = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    '../../../android/app/google-services.json',
  ), 'utf8'));
  const apiKey = googleServices.client.find(
    client => client.client_info.android_client_info.package_name === 'in.exgold.app',
  )?.api_key?.[0]?.current_key;
  if (!apiKey) throw new Error('Firebase Android API key is unavailable');

  const customToken = await admin.auth().createCustomToken(uid);
  const exchange = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      signal: AbortSignal.timeout(30000),
    },
  );
  const session = await exchange.json();
  if (!exchange.ok || !session.idToken) throw new Error('Demo Firebase session exchange failed');

  const statusResult = await request('/investment/status', session.idToken);
  if (!statusResult.response.ok) {
    throw new Error(`Investment status failed with HTTP ${statusResult.response.status}`);
  }
  if (statusResult.body?.buyEnabled !== true || statusResult.body?.providerReady !== true) {
    throw new Error(`Buy is blocked: ${statusResult.body?.buyBlockReason || 'unknown reason'}`);
  }

  const ratesResult = await request('/investment/rates?forceRefresh=true', session.idToken);
  if (!ratesResult.response.ok) {
    throw new Error(`Fresh Augmont rate failed with HTTP ${ratesResult.response.status}`);
  }

  const checkoutResult = await request('/payment/checkout/digital-gold', session.idToken, {
    method: 'POST',
    body: JSON.stringify({ amount: 5 }),
  });
  const checkout = checkoutResult.body?.checkout;
  if (checkoutResult.response.status !== 201 || !checkout?.orderId || !checkout?.checkoutId) {
    throw new Error(
      `Checkout failed with HTTP ${checkoutResult.response.status}: ${checkoutResult.body?.message || 'invalid response'}`,
    );
  }
  if (!String(checkout.keyId || '').startsWith('rzp_test_')) {
    throw new Error('Reviewer checkout is not using the Razorpay test environment');
  }

  console.log(JSON.stringify({
    result: 'ready',
    reviewer: user.phoneNumber,
    status: {
      buyEnabled: statusResult.body.buyEnabled,
      providerReady: statusResult.body.providerReady,
      providerEnvironment: statusResult.body.providerEnvironment,
      paymentEnvironment: 'test',
    },
    rates: {
      httpStatus: ratesResult.response.status,
      available: Boolean(ratesResult.body),
    },
    checkout: {
      httpStatus: checkoutResult.response.status,
      amount: checkout.amount,
      currency: checkout.currency,
      orderCreated: true,
    },
  }, null, 2));
})().catch(error => {
  console.error(JSON.stringify({ result: 'blocked', message: error.message }));
  process.exitCode = 1;
}).finally(async () => {
  await Promise.all(admin.apps.map(app => app.delete()));
});
