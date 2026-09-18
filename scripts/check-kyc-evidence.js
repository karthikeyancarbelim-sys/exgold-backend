const assert = require("node:assert/strict");
const {
  extractNerotixAadhaarEvidence,
  selectNerotixAadhaarEvidence,
} = require("../dist/utils/kyc-evidence");

const documentedDigilockerResult = {
  success: true,
  statusCode: 1,
  message: "Success",
  data: {
    txn_id: "T_TEST_123",
    name: "TEST USER",
    dob: "01-01-1990",
    gender: "M",
    address: "REDACTED",
    split_address: { state: "Tamil Nadu" },
    year_of_birth: "1990",
    mobile_hash: "REDACTED",
  },
};

const evidence = extractNerotixAadhaarEvidence(documentedDigilockerResult);
assert.equal(evidence.verified, true);
assert.equal(evidence.verifiedVia, "digilocker");
assert.equal(evidence.masked, null);
assert.equal(evidence.name, "TEST USER");
assert.equal(evidence.dob, "01-01-1990");
assert.equal(evidence.hasAddressEvidence, true);

const withMaskedNumber = extractNerotixAadhaarEvidence({
  ...documentedDigilockerResult,
  data: {
    ...documentedDigilockerResult.data,
    masked_aadhaar_number: "XXXX XXXX 1234",
  },
});
assert.equal(withMaskedNumber.masked, "XXXX XXXX 1234");

const pending = extractNerotixAadhaarEvidence({
  success: false,
  statusCode: 0,
  message: "Validation in process check after some time",
});
assert.equal(pending.verified, false);
assert.equal(pending.verifiedVia, null);

const callbackBeforeResult = selectNerotixAadhaarEvidence(
  {
    success: true,
    statusCode: 1,
    data: { txn_id: "CALLBACK_ONLY" },
  },
  documentedDigilockerResult
);
assert.equal(callbackBeforeResult.verified, true);
assert.equal(callbackBeforeResult.name, "TEST USER");

console.log("KYC evidence contract check passed");
