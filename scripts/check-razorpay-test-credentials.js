const fs = require('node:fs');
const newman = require('../../../.artifacts/postman-runtime/node_modules/newman');

// Credentials arrive from PowerShell's CSV parser and are never exported.
const keys = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
if (!/^rzp_test_[A-Za-z0-9]+$/.test(keys.key_id || '') || !keys.key_secret) {
  throw new Error('Valid Razorpay TEST keys are required');
}
const collection = {
  info: { name: 'ExGold outstanding Razorpay test credentials',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'basic', basic: [
    { key: 'username', value: '{{testKeyId}}', type: 'string' },
    { key: 'password', value: '{{testKeySecret}}', type: 'string' },
  ] },
  item: [{ name: 'Create unpaid TEST order for Rs.500', request: {
    method: 'POST', url: 'https://api.razorpay.com/v1/orders',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: JSON.stringify({ amount: 50000, currency: 'INR',
      receipt: 'exg_uat_' + Date.now(), notes: { purpose: 'credentials_check_only', demo: 'true' } }) },
  }, event: [{ listen: 'test', script: { exec: [
    "pm.test('Test credentials accepted', () => pm.response.to.have.status(200));",
    "pm.test('Unpaid order, no funds moved', () => { const o=pm.response.json(); pm.expect(o.status).to.eql('created'); pm.expect(o.amount_paid).to.eql(0); pm.expect(o.amount).to.eql(50000); });",
  ] } }] }],
};
newman.run({ collection, reporters: [], timeoutRequest: 20000,
  environment: { values: [{ key: 'testKeyId', value: keys.key_id },
    { key: 'testKeySecret', value: keys.key_secret }] } }, (err, summary) => {
  const result = { runner: 'newman', mode: 'test', realFundsMoved: false,
    requests: summary?.run.executions.map(e => ({ name: e.item.name, status: e.response?.code,
      assertions: (e.assertions || []).map(a => ({ name: a.assertion, passed: !a.error })) })),
    failures: summary?.run.failures.length ?? 1 };
  fs.writeFileSync(require('node:path').resolve(__dirname,
    '../../../outputs/RAZORPAY_TEST_CREDENTIAL_RESULTS.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = err || result.failures ? 1 : 0;
});
