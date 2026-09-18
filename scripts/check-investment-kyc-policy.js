const assert = require("node:assert/strict");
const { evaluateLocalInvestmentKyc } = require("../dist/utils/investment-kyc-policy");

const now = Date.parse("2026-08-12T00:00:00.000Z");
const future = new Date("2027-08-12T00:00:00.000Z");

const approvedWithoutMasks = evaluateLocalInvestmentKyc({
  aadhaarStatus: "approved",
  panStatus: "approved",
  currentStatus: "full",
  expiresAt: future,
  now,
});
assert.equal(approvedWithoutMasks.approved, true);
assert.equal(approvedWithoutMasks.status, "full");
assert.equal(approvedWithoutMasks.code, "approved");

const missingPan = evaluateLocalInvestmentKyc({
  aadhaarStatus: "approved",
  panStatus: "pending",
  currentStatus: "aadhaar",
  expiresAt: future,
  now,
});
assert.equal(missingPan.approved, false);
assert.equal(missingPan.code, "kyc_required");

const expired = evaluateLocalInvestmentKyc({
  aadhaarStatus: "approved",
  panStatus: "approved",
  currentStatus: "full",
  expiresAt: new Date("2026-08-11T00:00:00.000Z"),
  now,
});
assert.equal(expired.approved, false);
assert.equal(expired.code, "kyc_expired");

console.log("Investment KYC policy check passed");
