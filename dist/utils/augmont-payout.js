"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.augmontWithdrawalState = exports.augmontSaleState = exports.augmontTransactionConfirmed = exports.augmontDestinationMatches = exports.augmontDestinationState = void 0;
const provider_payload_1 = require("./provider-payload");
const augmontDestinationState = (payload, destination) => {
    const providerBankId = String((0, provider_payload_1.readDeep)(payload, ["userBankId", "user_bank_id", "bankId", "bank_id"]) || "");
    const providerAccount = (0, provider_payload_1.readDeep)(payload, [
        "accountNumber",
        "account_number",
        "bankAccountNumber",
    ]);
    const providerIfsc = (0, provider_payload_1.readDeep)(payload, ["ifscCode", "ifsc_code", "ifsc"]);
    const hasBankId = Boolean(providerBankId);
    const hasAccount = Boolean((0, provider_payload_1.accountLast4)(providerAccount));
    const hasIfsc = Boolean((0, provider_payload_1.normalizeIfsc)(providerIfsc));
    if (!hasBankId && !hasAccount && !hasIfsc)
        return "unknown";
    if (destination.userBankId &&
        hasBankId &&
        destination.userBankId !== providerBankId) {
        return "mismatch";
    }
    if (hasAccount &&
        (0, provider_payload_1.accountLast4)(providerAccount) !== (0, provider_payload_1.accountLast4)(destination.accountNumber)) {
        return "mismatch";
    }
    if (hasIfsc && (0, provider_payload_1.normalizeIfsc)(providerIfsc) !== (0, provider_payload_1.normalizeIfsc)(destination.ifscCode)) {
        return "mismatch";
    }
    return "match";
};
exports.augmontDestinationState = augmontDestinationState;
const augmontDestinationMatches = (payload, destination) => {
    const providerBankId = String((0, provider_payload_1.readDeep)(payload, ["userBankId", "user_bank_id", "bankId", "bank_id"]) || "");
    if (destination.userBankId &&
        providerBankId &&
        destination.userBankId === providerBankId) {
        return true;
    }
    const providerAccount = (0, provider_payload_1.readDeep)(payload, [
        "accountNumber",
        "account_number",
        "bankAccountNumber",
    ]);
    const providerIfsc = (0, provider_payload_1.readDeep)(payload, ["ifscCode", "ifsc_code", "ifsc"]);
    return (Boolean((0, provider_payload_1.accountLast4)(destination.accountNumber)) &&
        (0, provider_payload_1.accountLast4)(providerAccount) === (0, provider_payload_1.accountLast4)(destination.accountNumber) &&
        Boolean((0, provider_payload_1.normalizeIfsc)(providerIfsc)) &&
        (0, provider_payload_1.normalizeIfsc)(providerIfsc) === (0, provider_payload_1.normalizeIfsc)(destination.ifscCode));
};
exports.augmontDestinationMatches = augmontDestinationMatches;
const transactionStatus = (payload) => String((0, provider_payload_1.readDeep)(payload, [
    "transactionStatus", "transaction_status", "buyStatus", "sellStatus",
]) ?? (0, provider_payload_1.readDeep)(payload?.data ?? payload?.result ?? payload, ["status"]) ?? "").toLowerCase();
const augmontTransactionConfirmed = (payload) => {
    const status = transactionStatus(payload);
    const transactionId = (0, provider_payload_1.readDeep)(payload, ["transactionId", "transaction_id", "txnId", "txn_id", "id"]);
    if (!transactionId)
        return false;
    if (["success", "successful", "completed", "complete", "confirmed", "approved", "processed"].includes(status))
        return true;
    // An HTTP-success envelope cannot override a pending or failed transaction.
    if (status && status !== "200")
        return false;
    return (0, provider_payload_1.readDeep)(payload, ["success"]) === true ||
        Number((0, provider_payload_1.readDeep)(payload, ["statusCode", "status_code", "code"])) === 200;
};
exports.augmontTransactionConfirmed = augmontTransactionConfirmed;
const augmontSaleState = (payload) => {
    const status = transactionStatus(payload) || "pending";
    if (["failed", "rejected", "cancelled", "canceled", "reversed"].includes(status)) {
        return { state: "failed", status };
    }
    if ((0, exports.augmontTransactionConfirmed)(payload)) {
        return { state: "accepted", status };
    }
    return { state: "pending", status };
};
exports.augmontSaleState = augmontSaleState;
const augmontWithdrawalState = (payload) => {
    const status = String((0, provider_payload_1.readDeep)(payload, [
        "withdrawStatus",
        "withdraw_status",
        "payoutStatus",
        "payout_status",
        "paymentStatus",
        "payment_status",
        "transactionStatus",
        "transaction_status",
        "status",
    ]) || "pending").toLowerCase();
    const reference = String((0, provider_payload_1.readDeep)(payload, [
        "utr",
        "utrNumber",
        "utr_number",
        "rrn",
        "bankReference",
        "bank_reference",
        "payoutReference",
        "payout_reference",
        "referenceId",
        "reference_id",
    ]) || "").trim();
    if (["success", "successful", "paid", "completed", "processed", "transferred"].includes(status) &&
        reference) {
        return { state: "paid", status, reference };
    }
    if (["failed", "rejected", "cancelled", "canceled", "reversed"].includes(status)) {
        return { state: "failed", status, reference };
    }
    return { state: "pending", status, reference };
};
exports.augmontWithdrawalState = augmontWithdrawalState;
