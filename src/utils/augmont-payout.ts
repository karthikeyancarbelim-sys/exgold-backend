import {
  accountLast4,
  normalizeIfsc,
  readDeep,
} from "./provider-payload";

export type DirectBankDestination = {
  userBankId?: string;
  accountNumber: string;
  ifscCode: string;
};

export type AugmontDestinationState = "match" | "mismatch" | "unknown";

export const augmontDestinationState = (
  payload: any,
  destination: DirectBankDestination
): AugmontDestinationState => {
  const providerBankId = String(
    readDeep(payload, ["userBankId", "user_bank_id", "bankId", "bank_id"]) || ""
  );
  const providerAccount = readDeep(payload, [
    "accountNumber",
    "account_number",
    "bankAccountNumber",
  ]);
  const providerIfsc = readDeep(payload, ["ifscCode", "ifsc_code", "ifsc"]);
  const hasBankId = Boolean(providerBankId);
  const hasAccount = Boolean(accountLast4(providerAccount));
  const hasIfsc = Boolean(normalizeIfsc(providerIfsc));

  if (!hasBankId && !hasAccount && !hasIfsc) return "unknown";
  if (
    destination.userBankId &&
    hasBankId &&
    destination.userBankId !== providerBankId
  ) {
    return "mismatch";
  }
  if (
    hasAccount &&
    accountLast4(providerAccount) !== accountLast4(destination.accountNumber)
  ) {
    return "mismatch";
  }
  if (hasIfsc && normalizeIfsc(providerIfsc) !== normalizeIfsc(destination.ifscCode)) {
    return "mismatch";
  }
  return "match";
};

export const augmontDestinationMatches = (
  payload: any,
  destination: DirectBankDestination
) => {
  const providerBankId = String(
    readDeep(payload, ["userBankId", "user_bank_id", "bankId", "bank_id"]) || ""
  );
  if (
    destination.userBankId &&
    providerBankId &&
    destination.userBankId === providerBankId
  ) {
    return true;
  }

  const providerAccount = readDeep(payload, [
    "accountNumber",
    "account_number",
    "bankAccountNumber",
  ]);
  const providerIfsc = readDeep(payload, ["ifscCode", "ifsc_code", "ifsc"]);
  return (
    Boolean(accountLast4(destination.accountNumber)) &&
    accountLast4(providerAccount) === accountLast4(destination.accountNumber) &&
    Boolean(normalizeIfsc(providerIfsc)) &&
    normalizeIfsc(providerIfsc) === normalizeIfsc(destination.ifscCode)
  );
};

export type AugmontSaleState = {
  state: "accepted" | "pending" | "failed";
  status: string;
};

const transactionStatus = (payload: any) => String(readDeep(payload, [
    "transactionStatus", "transaction_status", "buyStatus", "sellStatus",
  ]) ?? readDeep(payload?.data ?? payload?.result ?? payload, ["status"]) ?? "").toLowerCase();

export const augmontTransactionConfirmed = (payload: any) => {
  const status = transactionStatus(payload);
  const transactionId = readDeep(payload, ["transactionId", "transaction_id", "txnId", "txn_id", "id"]);
  if (!transactionId) return false;
  if (["success", "successful", "completed", "complete", "confirmed", "approved", "processed"].includes(status)) return true;
  // An HTTP-success envelope cannot override a pending or failed transaction.
  if (status && status !== "200") return false;
  return readDeep(payload, ["success"]) === true ||
    Number(readDeep(payload, ["statusCode", "status_code", "code"])) === 200;
};

export const augmontSaleState = (payload: any): AugmontSaleState => {
  const status = transactionStatus(payload) || "pending";
  if (["failed", "rejected", "cancelled", "canceled", "reversed"].includes(status)) {
    return { state: "failed", status };
  }
  if (augmontTransactionConfirmed(payload)) {
    return { state: "accepted", status };
  }
  return { state: "pending", status };
};

export type AugmontWithdrawalState = {
  state: "paid" | "pending" | "failed";
  status: string;
  reference: string;
};

export const augmontWithdrawalState = (payload: any): AugmontWithdrawalState => {
  const status = String(
    readDeep(payload, [
      "withdrawStatus",
      "withdraw_status",
      "payoutStatus",
      "payout_status",
      "paymentStatus",
      "payment_status",
      "transactionStatus",
      "transaction_status",
      "status",
    ]) || "pending"
  ).toLowerCase();
  const reference = String(
    readDeep(payload, [
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
    ]) || ""
  ).trim();

  if (
    ["success", "successful", "paid", "completed", "processed", "transferred"].includes(
      status
    ) &&
    reference
  ) {
    return { state: "paid", status, reference };
  }
  if (["failed", "rejected", "cancelled", "canceled", "reversed"].includes(status)) {
    return { state: "failed", status, reference };
  }
  return { state: "pending", status, reference };
};
