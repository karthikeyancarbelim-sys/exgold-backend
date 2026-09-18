const assert = require("node:assert/strict");
const {
  augmontMerchantPolicy,
  indiaFinancialYearStart,
  roundGold,
  roundMoney,
  validateBuyAmount,
  validateSellQuantity,
  policyNumber,
} = require("../dist/utils/augmont-merchant-policy");

assert.equal(augmontMerchantPolicy.minimumBuyAmount, 5);
assert.equal(augmontMerchantPolicy.maximumBuyAmount, 5_000_000);
assert.equal(augmontMerchantPolicy.maximumSellAmount, 1_000_000);
assert.equal(augmontMerchantPolicy.kycFinancialYearThreshold, 180_000);
assert.equal(augmontMerchantPolicy.sellLockHours, 48);
assert.equal(augmontMerchantPolicy.maximumBankIds, 3);
assert.equal(augmontMerchantPolicy.maximumBankModifications, 3);
for (const raw of [undefined, "", " ", "NaN", "Infinity", "-1", "4", "5000001"]) {
  assert.equal(policyNumber(raw, 5, 5, 5_000_000), 5);
}
assert.equal(policyNumber("500", 5, 5, 5_000_000), 500);
assert.equal(policyNumber("0", 180_000, 0, 180_000), 0);
assert.equal(policyNumber("0", 48, 48, 8760), 48);
assert.equal(policyNumber("4", 3, 1, 3), 3);
assert.equal(indiaFinancialYearStart(new Date("2026-03-31T10:00:00Z")).toISOString(), "2025-03-31T18:30:00.000Z");
assert.equal(indiaFinancialYearStart(new Date("2026-04-01T10:00:00Z")).toISOString(), "2026-03-31T18:30:00.000Z");
assert.equal(roundMoney(10.005), 10.01);
assert.equal(roundMoney(1.005), 1.01);
assert.equal(roundMoney(480.865), 480.87);
assert.equal(roundMoney(-1.005), -1.01);
assert.equal(roundMoney(5_000_000), 5_000_000);
assert.equal(roundGold(0.00005), 0.0001);
assert.equal(roundGold(1e-7), 0);
assert.throws(() => roundMoney(NaN), /Invalid financial value/);
assert.equal(roundGold(0.123456), 0.1235);
assert.equal(validateBuyAmount(5), null);
assert.equal(validateBuyAmount(5_000_000), null);
for (const amount of [4.99, 5_000_000.01, 500.001, NaN, Infinity, -1]) {
  assert.ok(validateBuyAmount(amount));
}
assert.equal(validateSellQuantity(0.0296), null);
for (const quantity of [0, -1, 0.02961, NaN, Infinity]) {
  assert.ok(validateSellQuantity(quantity));
}

console.log("Augmont merchant policy check passed");
