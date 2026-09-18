import { pool } from "../config/db";
import {
  augmontCreateUser,
  augmontGetUser,
  augmontGetUserKyc,
  augmontSubmitUserKyc,
  augmontUpdateUser,
  extractDeep,
  isAugmontMissingResourceError,
} from "./augmont.service";
import { evaluateLocalInvestmentKyc } from "../utils/investment-kyc-policy";
import { buildAugmontProfile } from "../utils/augmont-profile";

export type InvestmentKycCode =
  | "approved"
  | "user_not_found"
  | "kyc_required"
  | "kyc_expired";

export type InvestmentKycEligibility = {
  userId: number | null;
  localStatus: string;
  localApproved: boolean;
  providerStatus: string;
  providerApproved: boolean;
  approved: boolean;
  expiresAt: string | null;
  code: InvestmentKycCode;
  message: string;
};

type EligibilityOptions = {
  refreshProvider?: boolean;
};

type ProviderSyncOptions = {
  force?: boolean;
};

const kycValidityDays = Number(process.env.KYC_VALIDITY_DAYS || 365);
const providerApprovedStatuses = new Set([
  "approved",
  "verified",
  "completed",
  "complete",
  "full",
  "success",
]);
const providerPendingStatuses = new Set([
  "pending",
  "submitted",
  "submitting",
  "processing",
  "under_review",
  "under review",
  "in_progress",
]);
const providerRejectedStatuses = new Set(["rejected", "declined"]);

const normalized = (value: any) => String(value || "").trim().toLowerCase();

const findValueDeep = (input: any, keys: string[]): any => {
  if (!input || typeof input !== "object") return undefined;
  if (Array.isArray(input)) {
    for (const item of input) {
      const value = findValueDeep(item, keys);
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
  }

  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (keys.includes(normalizedKey) && value !== undefined && value !== null && value !== "") {
      return value;
    }
    const nested = findValueDeep(value, keys);
    if (nested !== undefined && nested !== null && nested !== "") return nested;
  }
  return undefined;
};

const loadContext = async (firebaseUid: string) => {
  const result = await pool.query(
    `SELECT
       u.id AS user_id,
       u.firebase_uid,
       u.name AS user_name,
       u.phone AS user_phone,
       u.email AS user_email,
       u.city AS user_city,
       u.dob AS user_dob,
       a.line1 AS address_line1,
       a.line2 AS address_line2,
       a.city AS address_city,
       a.state AS address_state,
       a.pincode AS address_pincode,
       k.id AS kyc_id,
       k.status AS kyc_status,
       k.aadhaar_status,
       k.pan_status,
       k.pan_number,
       k.pan_name,
       k.aadhaar_payload,
       k.pan_payload,
       k.nerotix_payload,
       k.kycaid_payload,
       k.augmont_kyc_status,
       k.augmont_kyc_synced_at,
       k.kyc_expires_at,
       k.created_at AS kyc_created_at,
       k.updated_at AS kyc_updated_at
     FROM users u
     LEFT JOIN LATERAL (
       SELECT *
       FROM kyc
       WHERE user_id=u.id
       ORDER BY
         CASE
           WHEN (status IN ('full','approved','APPROVED')
                 OR (aadhaar_status='approved' AND pan_status='approved'))
                AND (kyc_expires_at IS NULL OR kyc_expires_at > NOW())
           THEN 0 ELSE 1
         END,
         updated_at DESC NULLS LAST,
         created_at DESC,
         id DESC
       LIMIT 1
     ) k ON TRUE
     LEFT JOIN LATERAL (
       SELECT line1, line2, city, state, pincode
       FROM user_addresses
       WHERE user_id=u.id
       ORDER BY is_default DESC, updated_at DESC, id DESC
       LIMIT 1
     ) a ON TRUE
     WHERE u.firebase_uid=$1
     LIMIT 1`,
    [firebaseUid]
  );
  return result.rows[0] || null;
};

const loadContextByUserId = async (userId: number) => {
  const result = await pool.query(
    `SELECT
       u.id AS user_id,
       u.firebase_uid,
       u.name AS user_name,
       u.phone AS user_phone,
       u.email AS user_email,
       u.city AS user_city,
       u.dob AS user_dob,
       a.line1 AS address_line1,
       a.line2 AS address_line2,
       a.city AS address_city,
       a.state AS address_state,
       a.pincode AS address_pincode,
       k.id AS kyc_id,
       k.status AS kyc_status,
       k.aadhaar_status,
       k.pan_status,
       k.pan_number,
       k.pan_name,
       k.aadhaar_payload,
       k.pan_payload,
       k.nerotix_payload,
       k.kycaid_payload,
       k.augmont_kyc_status,
       k.augmont_kyc_synced_at,
       k.kyc_expires_at,
       k.created_at AS kyc_created_at,
       k.updated_at AS kyc_updated_at
     FROM users u
     LEFT JOIN LATERAL (
       SELECT *
       FROM kyc
       WHERE user_id=u.id
       ORDER BY
         CASE
           WHEN (status IN ('full','approved','APPROVED')
                 OR (aadhaar_status='approved' AND pan_status='approved'))
                AND (kyc_expires_at IS NULL OR kyc_expires_at > NOW())
           THEN 0 ELSE 1
         END,
         updated_at DESC NULLS LAST,
         created_at DESC,
         id DESC
       LIMIT 1
     ) k ON TRUE
     LEFT JOIN LATERAL (
       SELECT line1, line2, city, state, pincode
       FROM user_addresses
       WHERE user_id=u.id
       ORDER BY is_default DESC, updated_at DESC, id DESC
       LIMIT 1
     ) a ON TRUE
     WHERE u.id=$1
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
};

const expiryDate = (context: any) => {
  if (!context?.kyc_id) return null;
  if (context.kyc_expires_at) {
    const explicit = new Date(context.kyc_expires_at);
    return Number.isNaN(explicit.getTime()) ? null : explicit;
  }
  const base = new Date(context.kyc_updated_at || context.kyc_created_at || 0);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + kycValidityDays * 24 * 60 * 60 * 1000);
};

const dateOnly = (value: any) => {
  if (!value) return "";
  const raw = String(value).trim();
  const ymd = raw.match(/^(\d{4})[-\/]([0-1]?\d)[-\/]([0-3]?\d)$/);
  const dmy = raw.match(/^([0-3]?\d)[-\/]([0-1]?\d)[-\/](\d{4})$/);
  const match = ymd
    ? { year: Number(ymd[1]), month: Number(ymd[2]), day: Number(ymd[3]) }
    : dmy
      ? { year: Number(dmy[3]), month: Number(dmy[2]), day: Number(dmy[1]) }
      : null;
  if (match) {
    const date = new Date(Date.UTC(match.year, match.month - 1, match.day));
    if (
      date.getUTCFullYear() === match.year &&
      date.getUTCMonth() === match.month - 1 &&
      date.getUTCDate() === match.day
    ) {
      return `${match.year.toString().padStart(4, "0")}-${match.month
        .toString()
        .padStart(2, "0")}-${match.day.toString().padStart(2, "0")}`;
    }
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const providerStatusFromPayload = (payload: any, fallback = "") =>
  normalized(extractDeep(payload, ["kycStatus", "kyc_status", "status"]) || fallback);

const providerSummary = (payload: any, status: string) => ({
  status,
  statusCode: extractDeep(payload, ["statusCode", "status_code", "code"]) || null,
  message: extractDeep(payload, ["message", "msg"]) || null,
  uniqueId: extractDeep(payload, ["uniqueId", "unique_id"]) || null,
});

const maskPan = (value: string) =>
  /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value)
    ? `${value.slice(0, 5)}****${value.slice(-1)}`
    : null;

const buildAugmontKycPayload = (context: any) => {
  const panNumber = String(
    context.pan_number ||
      findValueDeep(context.pan_payload || context.nerotix_payload || context.kycaid_payload, [
        "pannumber",
        "pan",
      ]) ||
      ""
  )
    .trim()
    .toUpperCase();
  const nameAsPerPan = String(
    context.pan_name ||
      findValueDeep(context.pan_payload || context.nerotix_payload || context.kycaid_payload, [
        "registeredname",
        "nameasperpan",
        "fullname",
        "name",
      ]) ||
      context.user_name ||
      ""
  ).trim();
  const dateOfBirth = dateOnly(
    context.user_dob ||
      findValueDeep(context.pan_payload || context.nerotix_payload || context.kycaid_payload, [
        "dateofbirth",
        "dob",
      ])
  );

  return {
    payload: {
      panNumber,
      dateOfBirth,
      nameAsPerPan,
      status: "approved",
    },
    missing: [
      !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber) ? "verified PAN" : "",
      !dateOfBirth ? "date of birth" : "",
      !nameAsPerPan ? "name as per PAN" : "",
    ].filter(Boolean),
  };
};

const buildAugmontUserPayload = (context: any) => {
  const result = buildAugmontProfile(context);
  const dateOfBirth = dateOnly(context.user_dob);
  return { ...result, payload: { ...result.payload, ...(dateOfBirth ? { dateOfBirth } : {}) } };
};

const ensureAugmontUserFromContext = async (context: any, options: { syncAddress?: boolean } = {}) => {
  const uniqueId = String(context?.firebase_uid || "");
  if (!uniqueId) throw new Error("User account is missing its provider identifier");

  try {
    const existing = await augmontGetUser(uniqueId);
    // Account already exists at Augmont. Address sync previously happened only
    // at first-ever account creation and never again: a customer who updates
    // their address after their first purchase would have invoices generated
    // against a stale (and, before the augmont-profile.ts fix, incomplete)
    // address indefinitely. Only push an update when the caller explicitly
    // supplied fresh address data (i.e. the user just saved/edited an address),
    // not on every buy/sell call, to avoid hitting Augmont's API on every
    // transaction.
    if (options.syncAddress) {
      const { payload, missing } = buildAugmontUserPayload(context);
      if (!missing.length) {
        try {
          await augmontUpdateUser(uniqueId, payload);
        } catch (updateError) {
          console.warn("AUGMONT ADDRESS SYNC FAILED:", (updateError as any)?.message || updateError);
        }
      }
    }
    return existing;
  } catch (lookupError) {
    if (!isAugmontMissingResourceError(lookupError)) throw lookupError;
  }

  const { payload, missing } = buildAugmontUserPayload(context);
  if (missing.length) {
    throw new Error(`Augmont account setup needs ${missing.join(" and ")}`);
  }

  try {
    return await augmontCreateUser(payload);
  } catch (createError) {
    // A timed-out first request or a concurrent checkout may already have
    // created the unique provider account. Verify before surfacing failure.
    try {
      return await augmontGetUser(uniqueId);
    } catch {
      throw createError;
    }
  }
};

export const ensureAugmontInvestmentUser = async (firebaseUid: string, address?: {
  line1: string; line2?: string; city: string; state: string; pincode: string;
}) => {
  const context = await loadContext(firebaseUid);
  if (!context) throw new Error("User account was not found");
  if (address) Object.assign(context, {
    address_line1: address.line1, address_line2: address.line2,
    address_city: address.city, address_state: address.state, address_pincode: address.pincode,
  });
  await ensureAugmontUserFromContext(context, { syncAddress: Boolean(address) });
  return context;
};

export const syncApprovedKycToAugmont = async (
  userId: number,
  _kyc?: any,
  options: ProviderSyncOptions = {}
) => {
  const context = await loadContextByUserId(userId);
  if (!context?.kyc_id || !context.firebase_uid) return "missing";

  const currentStatus = normalized(context.augmont_kyc_status);
  if (providerApprovedStatuses.has(currentStatus) && !options.force) return currentStatus;
  if (
    !options.force &&
    ((providerPendingStatuses.has(currentStatus) && currentStatus !== "submitting") ||
      providerRejectedStatuses.has(currentStatus))
  ) {
    return currentStatus;
  }

  const claimed = await pool.query(
    `UPDATE kyc
     SET augmont_kyc_status='submitting',
         augmont_kyc_synced_at=NOW(),
         updated_at=NOW()
     WHERE id=$1
       AND (
         $2::boolean = true
         OR
         augmont_kyc_status IS NULL
         OR augmont_kyc_status=''
         OR (
           LOWER(augmont_kyc_status) IN ('failed','skipped')
           AND COALESCE(augmont_kyc_synced_at, TO_TIMESTAMP(0)) < NOW() - INTERVAL '5 minutes'
         )
         OR (
           LOWER(augmont_kyc_status)='submitting'
           AND COALESCE(augmont_kyc_synced_at, TO_TIMESTAMP(0)) < NOW() - INTERVAL '5 minutes'
         )
       )
     RETURNING id`,
    [context.kyc_id, Boolean(options.force)]
  );
  if (!claimed.rowCount) return currentStatus || "submitting";

  const { payload, missing } = buildAugmontKycPayload(context);
  if (missing.length) {
    await pool.query(
      `UPDATE kyc
       SET augmont_kyc_status='skipped',
           augmont_kyc_error=$2,
           updated_at=NOW()
       WHERE id=$1`,
      [
        context.kyc_id,
        {
          message: `Augmont KYC needs ${missing.join(", ")}`,
          missing,
        },
      ]
    );
    return "skipped";
  }

  try {
    await ensureAugmontUserFromContext(context);
    const response = await augmontSubmitUserKyc(String(context.firebase_uid), payload);
    const status = providerStatusFromPayload(response, "submitted");
    await pool.query(
      `UPDATE kyc
       SET augmont_kyc_status=$2,
           augmont_kyc_synced_at=NOW(),
           augmont_kyc_payload=$3,
           augmont_kyc_error=NULL,
           updated_at=NOW()
       WHERE id=$1`,
      [
        context.kyc_id,
        status,
        {
          request: {
            panNumber: maskPan(payload.panNumber),
            dateOfBirth: payload.dateOfBirth,
            nameAsPerPan: payload.nameAsPerPan,
            status: payload.status,
          },
          response: providerSummary(response, status),
        },
      ]
    );
    return status;
  } catch (error: any) {
    await pool.query(
      `UPDATE kyc
       SET augmont_kyc_status='failed',
           augmont_kyc_synced_at=NOW(),
           augmont_kyc_error=$2,
           updated_at=NOW()
       WHERE id=$1`,
      [
        context.kyc_id,
        {
          message: error?.message || "Augmont KYC sync failed",
          missing: [],
        },
      ]
    );
    return "failed";
  }
};

const refreshAugmontKycStatus = async (context: any) => {
  if (!context?.kyc_id || !context.firebase_uid) return normalized(context?.augmont_kyc_status);
  try {
    const response = await augmontGetUserKyc(String(context.firebase_uid));
    const status = providerStatusFromPayload(response, normalized(context.augmont_kyc_status));
    if (!status) return "";
    await pool.query(
      `UPDATE kyc
       SET augmont_kyc_status=$2,
           augmont_kyc_synced_at=NOW(),
           augmont_kyc_payload=$3,
           augmont_kyc_error=NULL,
           updated_at=NOW()
       WHERE id=$1`,
      [context.kyc_id, status, { response: providerSummary(response, status) }]
    );
    return status;
  } catch (error: any) {
    await pool.query(
      `UPDATE kyc
       SET augmont_kyc_error=$2,
           updated_at=NOW()
       WHERE id=$1`,
      [context.kyc_id, { message: error?.message || "Unable to refresh Augmont KYC status" }]
    ).catch(() => null);
    return normalized(context.augmont_kyc_status);
  }
};

const resultFor = (
  context: any,
  localStatus: string,
  localApproved: boolean,
  providerStatus: string,
  expiresAt: Date | null,
  code: InvestmentKycCode,
  message: string
): InvestmentKycEligibility => {
  const providerApproved = providerApprovedStatuses.has(providerStatus);
  return {
    userId: context?.user_id ? Number(context.user_id) : null,
    localStatus,
    localApproved,
    providerStatus: providerStatus || "not_submitted",
    providerApproved,
    approved: localApproved,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    code,
    message,
  };
};

export const getInvestmentKycEligibility = async (
  firebaseUid: string,
  options: EligibilityOptions = {}
): Promise<InvestmentKycEligibility> => {
  let context = await loadContext(firebaseUid);
  if (!context) {
    return resultFor(
      null,
      "none",
      false,
      "not_submitted",
      null,
      "user_not_found",
      "User account was not found"
    );
  }

  const expiresAt = expiryDate(context);
  const localDecision = evaluateLocalInvestmentKyc({
    aadhaarStatus: context.aadhaar_status,
    panStatus: context.pan_status,
    currentStatus: context.kyc_status,
    expiresAt,
  });
  const localApproved = localDecision.approved;
  const localStatus = localDecision.status;

  if (localDecision.code === "kyc_expired") {
    await Promise.all([
      pool.query("UPDATE kyc SET status='expired', updated_at=NOW() WHERE id=$1", [context.kyc_id]),
      pool.query(
        "UPDATE users SET kyc_status='expired', kyc_verified=false WHERE id=$1",
        [context.user_id]
      ),
    ]);
    return resultFor(
      context,
      localStatus,
      false,
      normalized(context.augmont_kyc_status),
      expiresAt,
      localDecision.code,
      localDecision.message
    );
  }

  if (!localApproved) {
    return resultFor(
      context,
      localStatus,
      false,
      normalized(context.augmont_kyc_status),
      expiresAt,
      localDecision.code,
      localDecision.message
    );
  }

  let providerStatus = normalized(context.augmont_kyc_status);
  if (!providerApprovedStatuses.has(providerStatus) && !providerRejectedStatuses.has(providerStatus)) {
    providerStatus = await syncApprovedKycToAugmont(Number(context.user_id), context);
    context = (await loadContext(firebaseUid)) || context;
    providerStatus = normalized(context.augmont_kyc_status || providerStatus);
  }

  if (
    options.refreshProvider &&
    !providerApprovedStatuses.has(providerStatus) &&
    !providerRejectedStatuses.has(providerStatus)
  ) {
    const lastSync = new Date(context.augmont_kyc_synced_at || 0).getTime();
    const recentlyChecked = lastSync > 0 && Date.now() - lastSync < 15 * 1000;
    if (!recentlyChecked || providerStatus === "submitted") {
      providerStatus = await refreshAugmontKycStatus(context);
    }
  }

  return resultFor(
    context,
    localStatus,
    true,
    providerStatus,
    expiresAt,
    localDecision.code,
    localDecision.message
  );
};
