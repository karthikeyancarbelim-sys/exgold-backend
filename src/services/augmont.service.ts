import axios, { AxiosError } from "axios";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { PoolClient } from "pg";

import { pool } from "../config/db";
import { sharedAugmontRates } from "./augmont-rate-cache.service";
import { augmontMerchantPolicy, roundMoney, validateBuyAmount, validateSellQuantity } from "../utils/augmont-merchant-policy";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type AugmontBuyInput = {
  userId: string;
  amount?: number;
  quantity?: number;
  lockPrice?: number | string;
  blockId?: string;
  metalType?: "gold" | "silver" | string;
  merchantTransactionId?: string;
  modeOfPayment?: string;
  referenceType?: string;
  referenceId?: string;
};

type AugmontSellInput = {
  userId: string;
  grams?: number;
  amount?: number;
  lockPrice?: number | string;
  blockId?: string;
  metalType?: "gold" | "silver" | string;
  merchantTransactionId?: string;
  userBank?: Record<string, any>;
};

type AugmontRequestOptions = {
  method?: HttpMethod;
  path: string;
  data?: Record<string, any>;
  params?: Record<string, any>;
  encoding?: "json" | "form";
};

type TokenCache = {
  token: string;
  expiresAt: number;
};

type EncryptedToken = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

type AugmontRateOptions = {
  forceRefresh?: boolean;
  allowStale?: boolean;
};

export class AugmontProviderError extends Error {
  status?: number;
  providerResponse?: any;

  constructor(message: string, status?: number, providerResponse?: any) {
    super(message);
    this.name = "AugmontProviderError";
    this.status = status;
    this.providerResponse = providerResponse;
  }
}

export const isAugmontMissingResourceError = (error: unknown) => {
  const status = error instanceof AugmontProviderError ? error.status : undefined;
  return status === 404 || status === 422;
};

const trimSlash = (value = "") => value.replace(/\/+$/, "");
const leadSlash = (value = "") => (value.startsWith("/") ? value : `/${value}`);
const compact = (value: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(value).filter(([, next]) => next !== undefined && next !== null && next !== "")
  );

const configuredApiRoot = process.env.AUGMONT_API_ROOT || process.env.AUGMONT_URL;

if (process.env.NODE_ENV === "production" && !configuredApiRoot) {
  throw new Error("AUGMONT_API_ROOT must be configured in production");
}

const API_ROOT = trimSlash(configuredApiRoot || "https://uat-api.merchant.augmont.com/api");
const BASE_URL = trimSlash(
  process.env.AUGMONT_BASE_URL || `${API_ROOT}/merchant/v1`
);
const LOGIN_BASE_URL = trimSlash(process.env.AUGMONT_LOGIN_BASE_URL || BASE_URL);
const LOGIN_PATH = leadSlash(process.env.AUGMONT_LOGIN_PATH || "/auth/login");
const AUTH_HEADER = process.env.AUGMONT_AUTH_HEADER || "Authorization";
const AUTH_SCHEME = process.env.AUGMONT_AUTH_SCHEME ?? "Bearer";
const MERCHANT_HEADER = process.env.AUGMONT_MERCHANT_HEADER || "X-Merchant-Id";
const LOGIN_CONTENT_TYPE = (process.env.AUGMONT_LOGIN_CONTENT_TYPE || "form").toLowerCase();
let tokenCache: TokenCache | null = null;
let rateRequest: Promise<any> | null = null;
let authStoreReady: Promise<void> | null = null;

const AUTH_PROVIDER = "augmont";
const AUTH_LOCK_KEY = 2_046_735_911;
const TOKEN_EXPIRY_BUFFER_MS = 5_000;
const AUTH_REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

const client = axios.create({
  baseURL: BASE_URL,
  timeout: Number(process.env.AUGMONT_TIMEOUT_MS || 20000),
  headers: {
    Accept: "application/json",
    ...(process.env.AUGMONT_MERCHANT_ID
      ? { [MERCHANT_HEADER]: process.env.AUGMONT_MERCHANT_ID }
      : {}),
  },
});

const loginClient = axios.create({
  baseURL: LOGIN_BASE_URL,
  timeout: Number(process.env.AUGMONT_TIMEOUT_MS || 20000),
  headers: {
    Accept: "application/json",
    ...(process.env.AUGMONT_MERCHANT_ID
      ? { [MERCHANT_HEADER]: process.env.AUGMONT_MERCHANT_ID }
      : {}),
  },
});

const configured = () =>
  Boolean(
    process.env.AUGMONT_MERCHANT_ID &&
      process.env.AUGMONT_EMAIL &&
      process.env.AUGMONT_PASSWORD
  );

export const extractDeep = (value: any, keys: string[]): any => {
  if (!value || typeof value !== "object") return undefined;

  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }

  for (const nestedKey of ["data", "result", "response", "transaction", "rates"]) {
    const nested = value[nestedKey];
    if (nested && typeof nested === "object") {
      const found = extractDeep(nested, keys);
      if (found !== undefined && found !== null) return found;
    }
  }

  return undefined;
};

const augmontError = (error: unknown, fallback: string) => {
  const axiosError = error as AxiosError<any>;
  const response = axiosError.response?.data;
  const primaryMessage =
    extractDeep(response, ["message", "error", "errorMessage", "msg"]) ||
    axiosError.message ||
    axiosError.code ||
    "No response from Augmont";
  const validationMessages = Object.values(response?.errors || {})
    .flatMap((entries: any) => (Array.isArray(entries) ? entries : [entries]))
    .map((entry: any) => String(entry?.message || entry || "").trim())
    .filter(Boolean);
  const providerMessage = [primaryMessage, ...new Set(validationMessages)].join(" ");
  const status = axiosError.response?.status;
  return new AugmontProviderError(
    status ? `${fallback}: ${providerMessage} (${status})` : `${fallback}: ${providerMessage}`,
    status,
    response
  );
};

const toFormBody = (data: Record<string, any> = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(compact(data))) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === "object") {
          for (const [nestedKey, nestedValue] of Object.entries(item)) {
            if (nestedValue !== undefined && nestedValue !== null && nestedValue !== "") {
              params.append(`${key}[${index}][${nestedKey}]`, String(nestedValue));
            }
          }
        } else {
          params.append(`${key}[${index}]`, String(item));
        }
      });
    } else if (value && typeof value === "object") {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (nestedValue !== undefined && nestedValue !== null && nestedValue !== "") {
          params.append(`${key}[${nestedKey}]`, String(nestedValue));
        }
      }
    } else {
      params.append(key, String(value));
    }
  }
  return params;
};

const loginPayload = () => {
  const emailField = process.env.AUGMONT_EMAIL_FIELD || "email";
  const passwordField = process.env.AUGMONT_PASSWORD_FIELD || "password";
  const sendMerchantInBody = process.env.AUGMONT_SEND_MERCHANT_IN_BODY === "true";

  const payload: Record<string, string | undefined> = {
    [emailField]: process.env.AUGMONT_EMAIL,
    [passwordField]: process.env.AUGMONT_PASSWORD,
  };

  if (sendMerchantInBody) {
    const merchantField = process.env.AUGMONT_MERCHANT_FIELD || "merchantId";
    payload[merchantField] = process.env.AUGMONT_MERCHANT_ID;
  }

  return payload;
};

const ensureAuthStore = async () => {
  if (!authStoreReady) {
    authStoreReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS provider_auth_sessions (
          provider TEXT PRIMARY KEY,
          access_token_encrypted TEXT NOT NULL,
          token_iv TEXT NOT NULL,
          token_auth_tag TEXT NOT NULL,
          token_expires_at TIMESTAMPTZ NOT NULL,
          authenticated_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      .then(() => undefined)
      .catch((error) => {
        authStoreReady = null;
        throw error;
      });
  }
  return authStoreReady;
};

const tokenEncryptionKey = () => {
  const secret = process.env.AUGMONT_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "AUGMONT_TOKEN_ENCRYPTION_KEY or JWT_SECRET is required to persist the Augmont session"
    );
  }
  return createHash("sha256").update(secret).digest();
};

const encryptToken = (token: string): EncryptedToken => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
};

const decryptToken = (encrypted: EncryptedToken) => {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    tokenEncryptionKey(),
    Buffer.from(encrypted.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

const tokenExpiry = (payload: any) => {
  const raw = extractDeep(payload, ["expiresIn", "expires_in", "expires", "expiresAt", "expires_at"]);
  if (typeof raw === "string" && !/^\d+(\.\d+)?$/.test(raw.trim())) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }

  const numeric = Number(raw || process.env.AUGMONT_TOKEN_TTL_SECONDS || 86400);
  if (!Number.isFinite(numeric) || numeric <= 0) return Date.now() + 86_400_000;
  if (numeric > 1_000_000_000_000) return numeric;
  if (numeric > 1_000_000_000) return numeric * 1000;
  return Date.now() + numeric * 1000;
};

const storedAccessToken = async (connection: PoolClient) => {
  const result = await connection.query(
    `SELECT access_token_encrypted, token_iv, token_auth_tag,
            token_expires_at, authenticated_at
     FROM provider_auth_sessions
     WHERE provider=$1`,
    [AUTH_PROVIDER]
  );
  const row = result.rows[0];
  const expiresAt = row ? new Date(row.token_expires_at).getTime() : 0;
  const authenticatedAt = row ? new Date(row.authenticated_at).getTime() : 0;
  if (!row || expiresAt <= Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
    return { cache: null, authenticatedAt };
  }

  try {
    return {
      cache: {
        token: decryptToken({
          ciphertext: row.access_token_encrypted,
          iv: row.token_iv,
          authTag: row.token_auth_tag,
        }),
        expiresAt,
      } satisfies TokenCache,
      authenticatedAt,
    };
  } catch {
    await connection.query(
      `UPDATE provider_auth_sessions
       SET token_expires_at=NOW(), updated_at=NOW()
       WHERE provider=$1`,
      [AUTH_PROVIDER]
    );
    return { cache: null, authenticatedAt };
  }
};

const requestAccessToken = async () => {
  try {
    const payload = compact(loginPayload());
    const isJson = LOGIN_CONTENT_TYPE === "json";
    const response = await loginClient.post(
      LOGIN_PATH,
      isJson ? payload : toFormBody(payload),
      {
        headers: {
          "Content-Type": isJson
            ? "application/json"
            : "application/x-www-form-urlencoded",
        },
      }
    );
    const token = extractDeep(response.data, [
      "accessToken",
      "access_token",
      "token",
      "jwt",
      "jwtToken",
    ]);
    if (!token) {
      throw new Error("Augmont login response did not include an access token");
    }
    return { token: String(token), expiresAt: tokenExpiry(response.data) };
  } catch (error) {
    throw augmontError(error, "Augmont login failed");
  }
};

const persistAccessToken = async (connection: PoolClient, next: TokenCache) => {
  const encrypted = encryptToken(next.token);
  await connection.query(
    `INSERT INTO provider_auth_sessions
       (provider, access_token_encrypted, token_iv, token_auth_tag,
        token_expires_at, authenticated_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
     ON CONFLICT (provider) DO UPDATE SET
       access_token_encrypted=EXCLUDED.access_token_encrypted,
       token_iv=EXCLUDED.token_iv,
       token_auth_tag=EXCLUDED.token_auth_tag,
       token_expires_at=EXCLUDED.token_expires_at,
       authenticated_at=EXCLUDED.authenticated_at,
       updated_at=NOW()`,
    [
      AUTH_PROVIDER,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      new Date(next.expiresAt),
    ]
  );
};

const invalidateAccessToken = async () => {
  tokenCache = null;
  await ensureAuthStore();
  await pool.query(
    `UPDATE provider_auth_sessions
     SET token_expires_at=NOW(), updated_at=NOW()
     WHERE provider=$1`,
    [AUTH_PROVIDER]
  );
};

const getAccessToken = async () => {
  if (!configured()) {
    throw new Error("Augmont credentials are not configured");
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
    return tokenCache.token;
  }

  await ensureAuthStore();
  const connection = await pool.connect();
  try {
    await connection.query("SELECT pg_advisory_lock($1)", [AUTH_LOCK_KEY]);
    const stored = await storedAccessToken(connection);
    if (stored.cache) {
      tokenCache = stored.cache;
      return stored.cache.token;
    }
    if (
      stored.authenticatedAt > 0 &&
      Date.now() - stored.authenticatedAt < AUTH_REUSE_WINDOW_MS
    ) {
      throw new AugmontProviderError(
        "Augmont merchant session is unavailable and merchant login is limited to once every 24 hours"
      );
    }

    const fresh = await requestAccessToken();
    await persistAccessToken(connection, fresh);
    tokenCache = fresh;
    return fresh.token;
  } finally {
    await connection.query("SELECT pg_advisory_unlock($1)", [AUTH_LOCK_KEY]).catch(() => null);
    connection.release();
  }
};

const authHeaders = async () => {
  const token = await getAccessToken();
  return {
    [AUTH_HEADER]: AUTH_SCHEME ? `${AUTH_SCHEME} ${token}` : token,
  };
};

const formatPath = (path: string, values: Record<string, any>) =>
  Object.entries(values).reduce(
    (next, [key, value]) =>
      next.replace(new RegExp(`\\{${key}\\}`, "g"), encodeURIComponent(String(value))),
    path
  );

const transactionId = (prefix: string, userId: string) =>
  `${prefix}_${userId}_${Date.now()}`.slice(0, 30);

const ratePayload = async () => {
  // Transactions require a current quote and must not use an expired display rate.
  const rates = await augmontGetRates({ forceRefresh: true, allowStale: false });
  const data = extractDeep(rates, ["data"]) || rates;
  const nestedRates = extractDeep(data, ["rates"]) || data;
  return { raw: rates, data, rates: nestedRates };
};

const pickRate = (source: any, keys: string[]) =>
  Number(extractDeep(source, keys) || 0);

export const augmontRequest = async ({
  method = "GET",
  path,
  data,
  params,
  encoding = "json",
}: AugmontRequestOptions) => {
  const execute = async () => {
    const sendForm = encoding === "form";
    return client.request({
      method,
      url: leadSlash(path),
      data: sendForm ? toFormBody(data) : data,
      params: compact(params || {}),
      headers: {
        ...(await authHeaders()),
        "Content-Type": sendForm
          ? "application/x-www-form-urlencoded"
          : "application/json",
      },
    });
  };

  try {
    const response = await execute();
    return response.data;
  } catch (error) {
    const status = (error as AxiosError<any>).response?.status;
    if (status === 401 || status === 403) {
      await invalidateAccessToken();
      try {
        const response = await execute();
        return response.data;
      } catch (retryError) {
        throw augmontError(retryError, `Augmont ${method} ${path} failed`);
      }
    }
    throw augmontError(error, `Augmont ${method} ${path} failed`);
  }
};

export const augmontLogin = async () => {
  const token = await getAccessToken();
  return {
    success: true,
    tokenAvailable: Boolean(token),
    baseUrl: BASE_URL,
    loginBaseUrl: LOGIN_BASE_URL,
  };
};

export const augmontGetRates = async ({
  forceRefresh = false,
  allowStale = true,
}: AugmontRateOptions = {}) => {
  // forceRefresh never bypasses the merchant's provider request limit.
  // Coalesce within each process before borrowing a DB connection. Transaction
  // callers must never inherit another caller's stale-display fallback.
  if (!rateRequest) {
    rateRequest = sharedAugmontRates(
      () => augmontRequest({ method: "GET", path: "/rates" }), false,
    ).finally(() => { rateRequest = null; });
  }
  try {
    return await rateRequest;
  } catch (error) {
    if (!allowStale || forceRefresh) throw error;
    return sharedAugmontRates(async () => { throw error; }, true);
  }
};

export const augmontGetHistoricalData = async (params?: Record<string, any>) =>
  augmontRequest({ method: "GET", path: "/rolling-data", params });

export const augmontGetStates = async (params?: Record<string, any>) =>
  augmontRequest({ method: "GET", path: "/master/states", params });

export const augmontGetCities = async (params?: Record<string, any>) =>
  augmontRequest({ method: "GET", path: "/master/cities", params });

export const augmontGetProducts = async (params?: Record<string, any>) =>
  augmontRequest({ method: "GET", path: "/products", params });

export const augmontGetProduct = async (sku: string) =>
  augmontRequest({ method: "GET", path: `/products/${encodeURIComponent(sku)}` });

export const augmontCreateUser = async (data: Record<string, any>) =>
  augmontRequest({ method: "POST", path: "/users", data, encoding: "form" });

export const augmontUpdateUser = async (uniqueId: string, data: Record<string, any>) =>
  augmontRequest({
    method: "PUT",
    path: formatPath("/users/{uniqueId}", { uniqueId }),
    data,
    encoding: "form",
  });

export const augmontGetUser = async (uniqueId: string) =>
  augmontRequest({ method: "GET", path: formatPath("/users/{uniqueId}", { uniqueId }) });

export const augmontGetUserKyc = async (uniqueId: string) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/users/{uniqueId}/kyc", { uniqueId }),
  });

export const augmontSubmitUserKyc = async (uniqueId: string, data: Record<string, any>) =>
  augmontRequest({
    method: "POST",
    path: formatPath("/users/{uniqueId}/kyc", { uniqueId }),
    data,
    encoding: "form",
  });

export const augmontCreateUserBank = async (uniqueId: string, data: Record<string, any>) =>
  augmontRequest({
    method: "POST",
    path: formatPath("/users/{uniqueId}/banks", { uniqueId }),
    data,
    encoding: "form",
  });

export const augmontUpdateUserBank = async (
  uniqueId: string,
  userBankId: string,
  data: Record<string, any>
) =>
  augmontRequest({
    method: "POST",
    path: formatPath("/users/{uniqueId}/banks/{userBankId}", { uniqueId, userBankId }),
    data: { ...data, _method: "PUT" },
    encoding: "form",
  });

export const augmontGetUserBanks = async (uniqueId: string) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/users/{uniqueId}/banks", { uniqueId }),
  });

export const augmontDeleteUserBank = async (uniqueId: string, userBankId: string) =>
  augmontRequest({
    method: "DELETE",
    path: formatPath("/users/{uniqueId}/banks/{userBankId}", { uniqueId, userBankId }),
  });

export const augmontSaveUserAddress = async (uniqueId: string, data: Record<string, any>) =>
  augmontRequest({
    method: "POST",
    path: formatPath("/users/{uniqueId}/address", { uniqueId }),
    data,
    encoding: "form",
  });

export const augmontGetUserAddresses = async (uniqueId: string) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/users/{uniqueId}/address", { uniqueId }),
  });

export const augmontDeleteUserAddress = async (uniqueId: string, userAddressId: string) =>
  augmontRequest({
    method: "DELETE",
    path: formatPath("/users/{uniqueId}/address/{userAddressId}", {
      uniqueId,
      userAddressId,
    }),
  });

export const augmontBuyGold = async (data: AugmontBuyInput) => {
  const merchantTransactionId =
    data.merchantTransactionId || transactionId("EXGBUY", data.userId);
  const amount = Number(data.amount);
  const quantity = Number(data.quantity);
  const hasAmount = data.amount !== undefined && Number.isFinite(amount) && amount > 0;
  const hasQuantity = data.quantity !== undefined && Number.isFinite(quantity) && quantity > 0;

  if (hasAmount === hasQuantity) {
    throw new Error("Augmont buy requires exactly one of amount or quantity");
  }
  if (hasAmount) {
    const amountError = validateBuyAmount(amount);
    if (amountError) throw new Error(amountError);
  }
  if (hasQuantity && quantity < 0.01) {
    throw new Error("Minimum digital gold purchase is 0.01g. Please enter a higher quantity.");
  }
  const referenceType = String(data.referenceType || "").trim().toLowerCase();
  const referenceId = String(data.referenceId || "").trim();
  if (referenceType && referenceType !== "sip") {
    throw new Error("Augmont buy referenceType must be sip when supplied");
  }
  if (referenceType && !referenceId) {
    throw new Error("Augmont buy referenceId is required for a SIP reference");
  }
  if (data.modeOfPayment && String(data.modeOfPayment).length > 20) {
    throw new Error("Augmont buy modeOfPayment cannot exceed 20 characters");
  }

  const live = !data.lockPrice || !data.blockId ? await ratePayload() : null;
  const lockPrice =
    data.lockPrice ||
    pickRate(live, ["gBuy", "goldBuy", "gold_buy", "buyRate", "buy_rate"]);
  const blockId = data.blockId || extractDeep(live, ["blockId", "block_id"]);
  if (!Number.isFinite(Number(lockPrice)) || Number(lockPrice) <= 0 || !blockId) {
    throw new Error("A current Augmont price lock is unavailable");
  }

  const payload = compact({
    lockPrice,
    metalType: data.metalType || "gold",
    ...(hasAmount ? { amount: Number(amount.toFixed(2)) } : {}),
    ...(hasQuantity ? { quantity: Number(quantity.toFixed(4)) } : {}),
    merchantTransactionId,
    uniqueId: data.userId,
    blockId,
    modeOfPayment: data.modeOfPayment,
    ...(referenceType ? { referenceType, referenceId } : {}),
  });

  return augmontRequest({ method: "POST", path: "/buy", data: payload, encoding: "form" });
};

export const augmontGetBuyStatus = async (merchantTransactionId: string, uniqueId: string) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/buy/{merchantTransactionId}/{uniqueId}", {
      merchantTransactionId,
      uniqueId,
    }),
  });

export const augmontGetBuyList = async (uniqueId: string, params?: Record<string, any>) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/{uniqueId}/buy", { uniqueId }),
    params,
  });

export const augmontSellGold = async (data: AugmontSellInput) => {
  const invalidQuantity = validateSellQuantity(Number(data.grams));
  if (invalidQuantity) throw new Error(invalidQuantity);
  const merchantTransactionId =
    data.merchantTransactionId || transactionId("EXGSELL", data.userId);
  const live = !data.lockPrice || !data.blockId ? await ratePayload() : null;
  const lockPrice =
    data.lockPrice ||
    pickRate(live, ["gSell", "goldSell", "gold_sell", "sellRate", "sell_rate"]);
  const blockId = data.blockId || extractDeep(live, ["blockId", "block_id"]);
  if (!Number.isFinite(Number(lockPrice)) || Number(lockPrice) <= 0 || !blockId) {
    throw new Error("A current Augmont sell price lock is unavailable");
  }
  if (roundMoney(Number(data.grams) * Number(lockPrice)) > augmontMerchantPolicy.maximumSellAmount) {
    throw new Error("Maximum digital gold sale amount exceeded");
  }
  const userBank = data.userBank || {};
  const payload = compact({
    uniqueId: data.userId,
    lockPrice,
    blockId,
    metalType: data.metalType || "gold",
    quantity: data.grams,
    amount: data.amount,
    merchantTransactionId,
    "userBank[userBankId]": userBank.userBankId,
    "userBank[accountName]": userBank.accountName,
    "userBank[accountNumber]": userBank.accountNumber,
    "userBank[ifscCode]": userBank.ifscCode,
  });

  return augmontRequest({ method: "POST", path: "/sell", data: payload, encoding: "form" });
};

export const augmontGetSellStatus = async (merchantTransactionId: string, uniqueId: string) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/sell/{merchantTransactionId}/{uniqueId}", {
      merchantTransactionId,
      uniqueId,
    }),
  });

export const augmontGetSellList = async (uniqueId: string, params?: Record<string, any>) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/{uniqueId}/sell", { uniqueId }),
    params,
  });

export const augmontCreateOrder = async (data: Record<string, any>) =>
  augmontRequest({ method: "POST", path: "/order", data, encoding: "form" });

export const augmontGetOrderList = async (uniqueId: string, params?: Record<string, any>) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/{uniqueId}/order", { uniqueId }),
    params,
  });

export const augmontGetOrderInfo = async (merchantTransactionId: string, uniqueId: string) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/order/{merchantTransactionId}/{uniqueId}", {
      merchantTransactionId,
      uniqueId,
    }),
  });

export const augmontTransfer = async (data: Record<string, any>) =>
  augmontRequest({ method: "POST", path: "/transfer", data, encoding: "form" });

export const augmontGetTransferInfo = async (
  merchantTransactionId: string,
  uniqueId: string
) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/transfer/{merchantTransactionId}/{uniqueId}", {
      merchantTransactionId,
      uniqueId,
    }),
  });

export const augmontGetTransferList = async (uniqueId: string, params?: Record<string, any>) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/{uniqueId}/transfer", { uniqueId }),
    params,
  });

export const augmontGetWithdrawStatus = async (sellTxnId: string, uniqueId: string) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/withdraw/{sellTxnId}/{uniqueId}", { sellTxnId, uniqueId }),
  });

export const augmontUpdateWithdraw = async (
  sellTxnId: string,
  uniqueId: string,
  data: Record<string, any>
) =>
  augmontRequest({
    method: "PUT",
    path: formatPath("/withdraw/{sellTxnId}/{uniqueId}", { sellTxnId, uniqueId }),
    data,
    encoding: "form",
  });

export const augmontGetBuyInvoice = async (transactionId: string) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/invoice/{transactionId}", { transactionId }),
  });

export const augmontGetSellInvoice = async (transactionId: string) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/invoice/sell/{transactionId}", { transactionId }),
  });

export const augmontGetRedeemInvoice = async (transactionId: string) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/invoice/order/{transactionId}", { transactionId }),
  });

export const augmontGetSipRates = async () =>
  augmontRequest({ method: "GET", path: "/sip/rates" });

export const augmontGetPassbook = async (uniqueId: string) =>
  augmontRequest({
    method: "GET",
    path: formatPath("/users/{uniqueId}/passbook", { uniqueId }),
  });

export const augmontGetBalance = async (uniqueId: string) => {
  const [passbook, buyList, sellList] = await Promise.allSettled([
    augmontGetPassbook(uniqueId),
    augmontGetBuyList(uniqueId),
    augmontGetSellList(uniqueId),
  ]);

  return {
    passbook: passbook.status === "fulfilled" ? passbook.value : null,
    buyList: buyList.status === "fulfilled" ? buyList.value : null,
    sellList: sellList.status === "fulfilled" ? sellList.value : null,
  };
};
