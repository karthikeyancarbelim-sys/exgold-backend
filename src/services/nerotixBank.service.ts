import axios from "axios";

const DEFAULT_BANK_VERIFY_URL =
  "https://api.nerofy.in/api/v1/service/bank/verification";

const VALID_ACCOUNT_STATUSES = new Set([
  "BANK ACCOUNT IS VALID",
  "ACCOUNT IS VALID",
  "VALID",
  "ACCOUNT_IS_VALID",
]);

const TITLE_WORDS = new Set([
  "MR",
  "MRS",
  "MS",
  "MISS",
  "DR",
  "SHRI",
  "SMT",
  "KUMARI",
]);

export type NameMatchStatus = "matched" | "manual_review" | "not_checked";

export type NerotixBankVerification = {
  accountValid: boolean;
  providerStatus: string;
  providerMessage: string;
  transactionId: string | null;
  utr: string | null;
  accountHolderName: string | null;
  bankName: string | null;
  bankDetails: Record<string, unknown> | null;
  evidence: Record<string, unknown>;
};

const normalizeNameTokens = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !TITLE_WORDS.has(token));

export const compareAccountHolderName = (
  expectedName: string,
  providerName: string
): NameMatchStatus => {
  const expected = normalizeNameTokens(expectedName);
  const provider = normalizeNameTokens(providerName);
  if (!expected.length || !provider.length) return "not_checked";

  if (expected.join("") === provider.join("")) return "matched";

  const shorter = expected.length <= provider.length ? expected : provider;
  const longer = expected.length <= provider.length ? provider : expected;
  if (shorter.length >= 2 && shorter.every((token) => longer.includes(token))) {
    return "matched";
  }

  return "manual_review";
};

export const isValidNerotixBankStatus = (value: unknown) =>
  VALID_ACCOUNT_STATUSES.has(String(value || "").trim().toUpperCase());

const headers = () => {
  const token = String(process.env.NEROTIX_API_TOKEN || "").trim();
  if (!token) {
    const error = new Error("Nerotix bank verification is not configured");
    (error as any).code = "NEROTIX_TOKEN_MISSING";
    throw error;
  }

  const headerName = String(
    process.env.NEROTIX_AUTH_HEADER || "Authorization"
  ).trim();
  const scheme = String(process.env.NEROTIX_AUTH_SCHEME || "Bearer").trim();
  return {
    [headerName]: scheme ? `${scheme} ${token}` : token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
};

const safeEvidence = (payload: any): Record<string, unknown> => {
  const data = payload?.data || {};
  return {
    success: payload?.success === true,
    statusCode: payload?.statusCode ?? null,
    message: payload?.message || null,
    data: {
      txn_id: data.txn_id || data.transaction_id || null,
      bank_account: data.bank_account ? "masked" : null,
      ifsc: data.ifsc || data.ifsc_details?.ifsc || null,
      account_holder_name: data.account_holder_name || null,
      account_status: data.account_status || null,
      account_status_code: data.account_status_code || null,
      utr: data.utr || null,
      bank_details: data.bank_details || null,
      bank_name: data.bank_name || null,
      branch: data.branch || null,
      city: data.city || null,
      state: data.state || null,
    },
  };
};

export const verifyBankAccountWithNerotix = async (
  bankAccount: string,
  ifsc: string
): Promise<NerotixBankVerification> => {
  const timeout = Math.max(
    3000,
    Number(process.env.NEROTIX_BANK_VERIFY_TIMEOUT_MS || 15000)
  );
  const response = await axios.post(
    process.env.NEROTIX_BANK_VERIFY_URL || DEFAULT_BANK_VERIFY_URL,
    {
      bankAccount,
      ifsc,
    },
    {
      headers: headers(),
      timeout,
      validateStatus: (status) => status >= 200 && status < 500,
    }
  );

  const payload = response.data || {};
  const data = payload.data || {};
  const providerStatus = String(
    data.account_status || data.account_status_code || ""
  ).trim();
  const requestSucceeded =
    response.status >= 200 &&
    response.status < 300 &&
    payload.success === true &&
    Number(payload.statusCode) === 1;

  if (!requestSucceeded && !providerStatus) {
    const error = new Error(
      String(payload.message || "Nerotix bank verification request failed")
    );
    (error as any).code = "NEROTIX_BANK_VERIFY_FAILED";
    (error as any).providerPayload = safeEvidence(payload);
    throw error;
  }

  return {
    accountValid: requestSucceeded && isValidNerotixBankStatus(providerStatus),
    providerStatus,
    providerMessage: String(payload.message || providerStatus || "Verification completed"),
    transactionId: data.txn_id || data.transaction_id || null,
    utr: data.utr || null,
    accountHolderName: data.account_holder_name || null,
    bankName: data.bank_details?.bank || data.bank_name || null,
    bankDetails: data.bank_details || data.ifsc_details || null,
    evidence: safeEvidence(payload),
  };
};

