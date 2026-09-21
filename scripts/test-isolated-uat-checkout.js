const fs = require('node:fs');
const path = require('node:path');
const newman = require('../../../.artifacts/postman-runtime/node_modules/newman');
const base = 'http://127.0.0.1:19443';
(async () => {
  const response = await fetch(base + '/session', { signal: AbortSignal.timeout(10000) });
  const session = await response.json();
  if (!response.ok || session.mode !== 'test' || session.schema !== 'exgold_uat_20260918') throw new Error('Isolated UAT session required');
  const item = (name, method, url, body, assertions) => ({ name, request: {
    method, url: base + url, header: [{ key: 'Content-Type', value: 'application/json' }],
    ...(body ? { body: { mode: 'raw', raw: JSON.stringify(body) } } : {}),
  }, event: [{ listen: 'test', script: { exec: assertions } }] });
  const status = n => `pm.test('HTTP ${n}', () => pm.response.to.have.status(${n}));`;
  const collection = { info: { name: 'Outstanding isolated app checkout checks',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{idToken}}', type: 'string' }] },
    item: [
      item('Below Augmont minimum rejected', 'POST', '/payment/checkout/digital-gold', { amount: 4 }, [status(400)]),
      item('Above maximum rejected', 'POST', '/payment/checkout/digital-gold', { amount: 5000001 }, [status(400)]),
      item('Deprecated unpaid buy blocked', 'POST', '/investment/buy', { amount: 500 }, [status(410)]),
      item('Create app Rs.500 TEST checkout', 'POST', '/payment/checkout/digital-gold', { amount: 500 }, [status(201),
        "pm.test('Test gateway only', () => pm.expect(pm.response.json().checkout.keyId).to.match(/^rzp_test_/));",
        "if(pm.response.code===201){ const c=pm.response.json().checkout; pm.environment.set('checkoutId',c.checkoutId); pm.environment.set('orderId',c.orderId); }",
      ]),
      item('Invalid payment signature rejected', 'POST', '/payment/checkout/verify', {
        checkoutId: '{{checkoutId}}', orderId: '{{orderId}}', paymentId: 'pay_invalid_uat', signature: 'invalid',
      }, [status(400)]),
      item('Unpaid checkout does not credit portfolio', 'GET', '/investment/portfolio', null, [status(200),
        "pm.test('No invested credit before payment', () => pm.expect(Number(pm.response.json().totalInvested)).to.eql(0));",
      ]),
      item('No trade created before payment', 'GET', '/test-ledger', null, [status(200),
        "pm.test('No gold transaction', () => pm.expect(Number(pm.response.json().trades)).to.eql(0));",
      ]),
      item('Cannot sell without eligible holdings', 'POST', '/investment/sell', { grams: 0.0001 }, [
        status(400),
        "pm.test('No eligible holdings rejected', () => pm.expect(pm.response.json().code).to.eql('SELL_LOCK_PERIOD'));",
      ]),
      item('Buy above FY threshold requires verified KYC', 'POST', '/payment/checkout/digital-gold', { amount: 180001 }, [
        "pm.test('KYC restriction enforced', () => pm.expect(pm.response.code).to.be.oneOf([403,409]));",
      ]),
      item('Three-decimal buy amount rejected', 'POST', '/payment/checkout/digital-gold', { amount: 500.001 }, [status(400)]),
    ] };
  if (process.argv.includes('--remaining-failed')) collection.item = collection.item.filter(i => [
    'Below Augmont minimum rejected', 'Cannot sell without eligible holdings',
    'Buy above FY threshold requires verified KYC', 'Three-decimal buy amount rejected',
  ].includes(i.name));
  if (process.argv.includes('--after-payment')) collection.item = [
    item('Paid buy reflected in portfolio', 'GET', '/investment/portfolio', null, [status(200),
      "pm.test('Confirmed investment Rs.500', () => pm.expect(Number(pm.response.json().totalInvested)).to.eql(500));",
      "pm.test('Allocated holding 0.0303g', () => pm.expect(Number(pm.response.json().goldGrams)).to.eql(0.0303));",
      "pm.test('New purchase locked', () => pm.expect(Number(pm.response.json().sellableGoldGrams)).to.eql(0));",
    ]),
    item('Paid buy history has invoice reference and financial details', 'GET', '/investment/transactions', null, [status(200),
      "pm.test('One confirmed purchase', () => {const rows=pm.response.json(); pm.expect(rows).to.have.lengthOf(1); const t=rows[0]; pm.expect(t.activity_type).to.eql('buy'); pm.expect(Number(t.total_amount)).to.eql(500); pm.expect(t.invoice_available).to.eql(true); pm.expect(t.provider_transaction_id).to.be.a('string').and.not.empty; pm.expect(Number(t.quantity)).to.eql(0.0303); for(const k of ['rate','taxable_amount','tax_rate','tax_amount']) pm.expect(Number(t[k])).to.be.above(0); pm.expect(t.created_at).to.be.a('string'); pm.environment.set('providerTxnId',t.provider_transaction_id); });",
    ]),
    item('Confirmed buy invoice retrieval', 'GET', '/augmont/invoice/buy/{{providerTxnId}}', null, [status(200),
      "pm.test('Provider invoice response successful', () => pm.expect(pm.response.json().success).to.eql(true));",
    ]),
    item('Immediate sell blocked by 48-hour lock', 'POST', '/investment/sell', { grams: 0.0303 }, [status(400),
      "pm.test('48-hour lock and balance retained', () => {const b=pm.response.json(); pm.expect(b.code).to.eql('SELL_LOCK_PERIOD'); pm.expect(Number(b.lockedGoldGrams)).to.eql(0.0303); pm.expect(b.sellUnlockAt).to.be.a('string');});",
    ]),
  ];
  if (process.argv.includes('--provider-match')) collection.item = [
    item('Load confirmed app record for provider comparison', 'GET', '/investment/transactions', null, [
      "pm.environment.set('appBuy',JSON.stringify(pm.response.json()[0]));",
    ]),
    item('Provider buy financial fields match app history', 'GET', '/augmont/users/5TCyBmRko2TT9Wdr3T9Xr1SlI0s1/buy', null, [status(200),
      "pm.test('All provider buy fields match', () => {const a=JSON.parse(pm.environment.get('appBuy'));const p=pm.response.json().data.result.data.find(x=>x.transactionId===a.provider_transaction_id);pm.expect(p).to.exist; for(const [app,provider] of [['quantity','qty'],['rate','exclTaxRate'],['taxable_amount','exclTaxAmt'],['tax_rate','taxRate'],['tax_amount','taxAmt'],['total_amount','inclTaxAmt']]) pm.expect(Number(a[app]),app).to.eql(Number(p[provider]));pm.expect(p.merchantTransactionId).to.eql(a.reference_id);pm.expect(new Date(p.createdAt).getTime()).to.be.a('number').and.not.NaN; });",
    ]),
    item('Provider passbook matches allocated holding', 'GET', '/augmont/users/5TCyBmRko2TT9Wdr3T9Xr1SlI0s1/passbook', null, [status(200),
      "pm.test('Provider holding matches 0.0303g', () => pm.expect(Number(pm.response.json().data.result.data.goldGrms)).to.eql(0.0303));",
    ]),
  ];
  newman.run({ collection, reporters: [], timeoutRequest: 60000,
    environment: { values: [{ key: 'idToken', value: session.idToken }] } }, (err, summary) => {
    const result = { runner: 'newman', razorpay: 'test', augmont: 'uat', ledger: 'isolated',
      otpFlowTested: false, realFundsMoved: false, sandboxPaymentCompleted: process.argv.includes('--after-payment'),
      requests: summary?.run.executions.map(e => ({ name: e.item.name, status: e.response?.code,
        assertions: (e.assertions || []).map(a => ({ name: a.assertion, passed: !a.error })),
        error: e.response?.code >= 400 ? String(JSON.parse(e.response.stream.toString()).message || '').slice(0, 300) : undefined })),
      failures: summary?.run.failures.length ?? 1 };
    fs.writeFileSync(path.resolve(__dirname, '../../../outputs/' + (process.argv.includes('--after-payment')
      ? 'AUGMONT_UAT_PAID_BUY_RESULTS.json' : process.argv.includes('--provider-match')
        ? 'AUGMONT_UAT_PROVIDER_MATCH_RESULTS.json' : process.argv.includes('--remaining-failed')
        ? 'AUGMONT_UAT_CHECKOUT_REMAINING_RESULTS.json' : 'AUGMONT_UAT_CHECKOUT_RESULTS.json')), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = err || result.failures ? 1 : 0;
  });
})().catch(e => { console.error(e.message); process.exitCode = 1; });
