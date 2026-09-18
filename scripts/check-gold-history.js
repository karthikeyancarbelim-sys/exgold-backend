const assert = require('node:assert/strict');
const { goldHistoryDetails } = require('../dist/utils/gold-history');
const buy = goldHistoryDetails({
  activity_type: 'buy', amount: 103, gold_grams: 0.1, status: 'success',
  provider_transaction_id: 'AUG-BUY-1', reference_id: 'EXG-BUY-1',
  created_at: '2026-09-18T05:00:00Z',
  details: { data: { metalType: 'gold', taxes: { taxRate: 3, taxAmount: 3 } } },
});
assert.equal(buy.rate, 1000, 'fallback buy rate must exclude GST');
assert.equal(buy.taxable_amount, 100);
assert.equal(buy.tax_amount, 3);
assert.equal(buy.total_amount, 103);
assert.equal(buy.quantity, 0.1);
assert.equal(buy.invoice_available, true);
assert.equal(buy.provider_transaction_id, 'AUG-BUY-1');
assert.equal(buy.created_at, '2026-09-18T05:00:00Z');
const sell = goldHistoryDetails({ activity_type: 'sell', amount: 480.86, gold_grams: 0.0296,
  details: { taxRate: 3, taxAmount: 14, lockPrice: 16245.27 } });
assert.equal(sell.tax_rate, 0);
assert.equal(sell.tax_amount, 0);
assert.equal(sell.taxable_amount, 480.86);
assert.equal(sell.rate, 16245.27);
assert.equal(sell.invoice_available, false);
assert.equal(goldHistoryDetails({ ...buy, gold_grams: 0 }).invoice_available, false);
assert.equal(goldHistoryDetails({ activity_type: 'buy', amount: 500, gold_grams: 0.03, status: 'pending' }).invoice_available, false);
const zeroTax = goldHistoryDetails({ activity_type: 'buy', amount: 100, gold_grams: 0.1,
  details: { taxRate: 0, taxAmount: 0 } });
assert.equal(zeroTax.tax_amount, 0);
assert.equal(zeroTax.tax_rate, 0);
console.log('Gold history checks passed: GST, zero-tax sells, precision, references and invoice gating');
const { augmontTransactionConfirmed, augmontSaleState } = require('../dist/utils/augmont-payout');
assert.equal(augmontTransactionConfirmed({ statusCode: 200, transactionStatus: 'pending', transactionId: 'AUG-1' }), false);
assert.equal(augmontTransactionConfirmed({ statusCode: 200, status: 'success', data: { status: 'failed', transactionId: 'AUG-1' } }), false);
assert.equal(augmontTransactionConfirmed({ statusCode: 200, status: 'success', data: { transactionStatus: 'pending', transactionId: 'AUG-1' } }), false);
assert.equal(augmontSaleState({ statusCode: 200, status: 'pending', transactionId: 'AUG-1' }).state, 'pending');
assert.equal(augmontSaleState({ status: 'success', data: { status: 'failed', transactionId: 'AUG-1' } }).state, 'failed');
