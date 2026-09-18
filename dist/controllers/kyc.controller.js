"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyKyc = exports.nerotixCallback = exports.kycaidCallback = exports.verifyPan = exports.createKycSession = exports.startKyc = void 0;
const db_1 = require("../config/db");
const kyc_service_1 = require("../services/kyc.service");
const investment_kyc_service_1 = require("../services/investment-kyc.service");
const kyc_evidence_1 = require("../utils/kyc-evidence");
const steps = ["aadhaar", "pan", "video", "full"];
const normalizeStep = (value) => {
    const step = String(value || "full").toLowerCase();
    return steps.includes(step) ? step : null;
};
const overallStatus = (kyc) => {
    if (!kyc)
        return "none";
    if (String(kyc.status || "").toLowerCase() === "expired")
        return "expired";
    if (kyc.aadhaar_status === "rejected" ||
        kyc.pan_status === "rejected" ||
        kyc.video_status === "rejected") {
        return "rejected";
    }
    if (kyc.aadhaar_status === "approved" && kyc.pan_status === "approved") {
        return "full";
    }
    if (kyc.aadhaar_status === "pending" ||
        kyc.pan_status === "pending" ||
        kyc.video_status === "pending" ||
        kyc.aadhaar_status === "approved" ||
        kyc.pan_status === "approved" ||
        kyc.video_status === "approved") {
        return "pending";
    }
    return "none";
};
const pendingExpiryMinutes = Number(process.env.KYC_PENDING_EXPIRY_MINUTES || 1440);
const kycValidityDays = Number(process.env.KYC_VALIDITY_DAYS || 365);
const isApprovedStatus = (status) => ["full", "approved"].includes(status.toLowerCase());
const kycExpiryDate = (kyc) => {
    if (!kyc)
        return null;
    if (kyc.kyc_expires_at)
        return new Date(kyc.kyc_expires_at);
    const base = new Date(kyc.kyc_completed_at || kyc.updated_at || kyc.created_at || Date.now());
    if (Number.isNaN(base.getTime()))
        return null;
    return new Date(base.getTime() + kycValidityDays * 24 * 60 * 60 * 1000);
};
const isKycExpired = (kyc) => {
    const expiry = kycExpiryDate(kyc);
    return Boolean(expiry && expiry.getTime() <= Date.now());
};
const isActiveApprovedKyc = (kyc) => {
    if (!kyc)
        return false;
    return isApprovedStatus(overallStatus(kyc)) && !isKycExpired(kyc);
};
const findValueDeep = (input, keys) => {
    if (!input || typeof input !== "object")
        return null;
    if (Array.isArray(input)) {
        for (const item of input) {
            const value = findValueDeep(item, keys);
            if (value)
                return value;
        }
        return null;
    }
    for (const [key, value] of Object.entries(input)) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (keys.includes(normalizedKey) && value)
            return value;
        const nested = findValueDeep(value, keys);
        if (nested)
            return nested;
    }
    return null;
};
const maskPan = (value) => {
    const pan = String(value || "").trim().toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan))
        return null;
    return `${pan.slice(0, 5)}****${pan.slice(-1)}`;
};
const publicKyc = (kyc) => {
    if (!kyc)
        return null;
    const { pan_number, aadhaar_payload, pan_payload, nerotix_payload, kycaid_payload, augmont_kyc_payload, augmont_kyc_error, ...safe } = kyc;
    const aadhaarEvidence = (0, kyc_evidence_1.selectNerotixAadhaarEvidence)(aadhaar_payload, nerotix_payload);
    return {
        ...safe,
        aadhaar_masked: kyc.aadhaar_masked || aadhaarEvidence.masked,
        aadhaar_verified_via: aadhaarEvidence.verifiedVia,
        aadhaar_verified_name: aadhaarEvidence.verified ? aadhaarEvidence.name : null,
        aadhaar_verified_dob: aadhaarEvidence.verified ? aadhaarEvidence.dob : null,
        aadhaar_verified_year: aadhaarEvidence.verified ? aadhaarEvidence.yearOfBirth : null,
        aadhaar_verified_gender: aadhaarEvidence.verified ? aadhaarEvidence.gender : null,
        pan_masked: kyc.pan_masked || maskPan(pan_number),
    };
};
const isPendingExpired = (kyc) => {
    const status = String(kyc?.status || "").toLowerCase();
    const hasPendingStep = String(kyc?.aadhaar_status || "").toLowerCase() === "pending" ||
        String(kyc?.pan_status || "").toLowerCase() === "pending" ||
        String(kyc?.video_status || "").toLowerCase() === "pending";
    if (status !== "pending" && !hasPendingStep)
        return false;
    const touchedAt = new Date(kyc.updated_at || kyc.created_at || 0).getTime();
    if (!touchedAt)
        return false;
    return Date.now() - touchedAt > pendingExpiryMinutes * 60 * 1000;
};
const getOrCreateKycRow = async (userId) => {
    const existing = await db_1.pool.query(`SELECT *
     FROM kyc
     WHERE user_id=$1
     ORDER BY
       CASE
         WHEN status IN ('full','approved','APPROVED')
           OR (aadhaar_status='approved' AND pan_status='approved')
         THEN 0 ELSE 1
       END,
       updated_at DESC NULLS LAST,
       created_at DESC
     LIMIT 1`, [userId]);
    if (existing.rows.length > 0)
        return existing.rows[0];
    const created = await db_1.pool.query(`INSERT INTO kyc (user_id, status)
     VALUES ($1,'none')
     RETURNING *`, [userId]);
    return created.rows[0];
};
const textValueDeep = (input, keys) => {
    const value = findValueDeep(input, keys);
    return value === null || value === undefined ? "" : String(value).trim();
};
const syncUserKycStatus = async (userId, kyc) => {
    const status = isKycExpired(kyc) && isApprovedStatus(overallStatus(kyc)) ? "expired" : overallStatus(kyc);
    await db_1.pool.query(`UPDATE users
     SET kyc_status=$1,
         kyc_verified=$2,
         kyc_completed_at=CASE WHEN $2 THEN COALESCE(kyc_completed_at, NOW()) ELSE kyc_completed_at END
     WHERE id=$3`, [status, status === "full", userId]);
    if (status === "full") {
        await db_1.pool.query(`UPDATE kyc
       SET status='full',
           kyc_expires_at=COALESCE(kyc_expires_at, NOW() + ($2::text || ' days')::interval),
           updated_at=NOW()
       WHERE id=$1`, [kyc.id, kycValidityDays]);
        await (0, investment_kyc_service_1.syncApprovedKycToAugmont)(userId, kyc);
    }
    return status;
};
const isNerotixSuccess = (payload) => {
    return (0, kyc_evidence_1.extractNerotixAadhaarEvidence)(payload).verified;
};
const nerotixFailureMessage = (payload) => String(payload?.message || payload?.data?.message || "").trim().toLowerCase();
const isNerotixRejected = (payload) => {
    if (payload?.success !== false || Number(payload?.statusCode) !== 0)
        return false;
    const message = nerotixFailureMessage(payload);
    return (message.includes("invalid aadhaar") ||
        message.includes("aadhaar card invalid") ||
        message.includes("rejected") ||
        message.includes("declined"));
};
const isNerotixSessionExpired = (payload) => {
    if (payload?.success !== false || Number(payload?.statusCode) !== 0)
        return false;
    const message = nerotixFailureMessage(payload);
    return (message.includes("otp expired") ||
        message.includes("session expired") ||
        message.includes("transaction expired") ||
        message.includes("refund"));
};
const isKycProviderAuthFailure = (error) => {
    const status = Number(error?.response?.status || 0);
    const providerError = error?.response?.data || error;
    const message = String(providerError?.message || error?.message || "").toLowerCase();
    return (status === 401 ||
        status === 403 ||
        message.includes("token not found") ||
        message.includes("already logged out") ||
        message.includes("token type mismatch"));
};
const kycProviderUnavailable = (res) => res.status(503).json({
    success: false,
    code: "KYC_PROVIDER_AUTH_UNAVAILABLE",
    message: "KYC verification is temporarily unavailable. Please try again shortly.",
});
const refreshNerotixAadhaarStatus = async (kyc) => {
    const provider = String(kyc?.kyc_provider || "").toLowerCase();
    const aadhaarStatus = String(kyc?.aadhaar_status || "").toLowerCase();
    if (provider !== "nerotix" || aadhaarStatus !== "pending")
        return kyc;
    try {
        const payload = await (0, kyc_service_1.getNerotixDigilockerData)(kyc);
        if (!payload)
            return kyc;
        const approved = isNerotixSuccess(payload);
        const rejected = isNerotixRejected(payload);
        const expired = isNerotixSessionExpired(payload);
        if (!approved && !rejected && !expired)
            return kyc;
        if (expired) {
            const result = await db_1.pool.query(`UPDATE kyc
         SET aadhaar_status='none',
             status='expired',
             nerotix_payload=$2,
             updated_at=NOW()
         WHERE id=$1
         RETURNING *`, [kyc.id, payload]);
            const updated = result.rows[0];
            await syncUserKycStatus(updated.user_id, updated);
            return updated;
        }
        const nextStatus = approved ? "approved" : "rejected";
        const aadhaarMasked = approved ? (0, kyc_evidence_1.extractMaskedAadhaar)(payload) : null;
        const result = await db_1.pool.query(`UPDATE kyc
       SET aadhaar_status=$1,
           status=CASE
             WHEN $1='rejected' THEN 'rejected'
             WHEN pan_status='approved' THEN 'full'
             ELSE 'pending'
           END,
           aadhaar_payload=$2,
           nerotix_payload=$2,
           aadhaar_masked=COALESCE($4, aadhaar_masked),
           updated_at=NOW()
       WHERE id=$3
       RETURNING *`, [nextStatus, payload, kyc.id, aadhaarMasked]);
        const updated = result.rows[0];
        await syncUserKycStatus(updated.user_id, updated);
        return updated;
    }
    catch (error) {
        const providerMessage = String(error?.response?.data?.message || "").toLowerCase();
        const providerHttpStatus = Number(error?.response?.status || 0);
        if ([400, 404, 410, 422].includes(providerHttpStatus) &&
            (providerMessage.includes("session expired") ||
                providerMessage.includes("transaction expired") ||
                providerMessage.includes("otp expired") ||
                providerMessage.includes("refund"))) {
            const expired = await db_1.pool.query(`UPDATE kyc
         SET aadhaar_status='none',
             status='expired',
             updated_at=NOW()
         WHERE id=$1
         RETURNING *`, [kyc.id]);
            const updated = expired.rows[0];
            await db_1.pool.query(`UPDATE users
         SET kyc_status='none',
             kyc_verified=false
         WHERE id=$1`, [updated.user_id]);
            return updated;
        }
        console.warn("NEROTIX AADHAAR REFRESH SKIPPED:", error?.response?.data || error?.message || error);
        return kyc;
    }
};
const scheduleNerotixAadhaarRefresh = (kycId) => {
    const delays = [
        8000,
        20000,
        45000,
        90000,
        150000,
        300000,
        600000,
        900000,
        1800000,
    ];
    delays.forEach((delay) => {
        setTimeout(async () => {
            try {
                const result = await db_1.pool.query("SELECT * FROM kyc WHERE id=$1 LIMIT 1", [kycId]);
                const kyc = result.rows[0];
                if (!kyc || String(kyc.aadhaar_status || "").toLowerCase() !== "pending")
                    return;
                await refreshNerotixAadhaarStatus(kyc);
            }
            catch (error) {
                console.warn("NEROTIX BACKGROUND REFRESH SKIPPED:", error?.response?.data || error?.message || error);
            }
        }, delay);
    });
};
const startKyc = async (req, res) => {
    try {
        const step = normalizeStep(req.params.step || req.body.step);
        if (!step)
            return res.status(400).json({ message: "Invalid KYC step" });
        const userResult = await db_1.pool.query("SELECT id, name FROM users WHERE firebase_uid=$1", [req.user.uid]);
        const user = userResult.rows[0];
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const row = await getOrCreateKycRow(user.id);
        const isKycaid = (process.env.KYC_PROVIDER || "kycaid") === "kycaid";
        const provider = (process.env.KYC_PROVIDER || "kycaid").toLowerCase();
        const statusColumn = isKycaid ? "pan_status" : `${step}_status`;
        const referenceColumn = isKycaid ? "pan_reference_id" : `${step}_reference_id`;
        if (isActiveApprovedKyc(row) || row[statusColumn] === "approved") {
            return res.json({
                success: true,
                step: isKycaid ? "full" : step,
                kyc: row,
                overallStatus: await syncUserKycStatus(user.id, row),
            });
        }
        const kycRequest = await (0, kyc_service_1.createKycRequest)(user);
        const referenceId = kycRequest.id ||
            kycRequest.reference_id ||
            kycRequest.request_id ||
            kycRequest.form_token ||
            null;
        const updated = isKycaid
            ? await db_1.pool.query(`UPDATE kyc
           SET aadhaar_status='pending',
               pan_status='pending',
               video_reference_id=$1,
               reference_id=COALESCE(reference_id, $1),
               kycaid_form_url=$2,
               kyc_provider=$4,
               status='pending',
               updated_at=NOW()
           WHERE id=$3
           RETURNING *`, [referenceId, kycRequest.form_url || kycRequest.url || kycRequest.formUrl || null, row.id, provider])
            : await db_1.pool.query(`UPDATE kyc
           SET ${statusColumn}='pending',
               ${referenceColumn}=$1,
               reference_id=COALESCE(reference_id, $1),
               kyc_provider=$3,
               status='pending',
               updated_at=NOW()
           WHERE id=$2
           RETURNING *`, [referenceId, row.id, provider]);
        const kyc = updated.rows[0];
        const userKycStatus = await syncUserKycStatus(user.id, kyc);
        res.json({
            success: true,
            step: isKycaid ? "full" : step,
            kyc,
            kycaid: isKycaid ? kycRequest : undefined,
            formUrl: kycRequest.form_url || kycRequest.url || kycRequest.formUrl,
            overallStatus: userKycStatus,
        });
    }
    catch (error) {
        console.error("KYC initiation failed:", error);
        res.status(500).json({ error: "KYC initiation failed" });
    }
};
exports.startKyc = startKyc;
const createKycSession = async (req, res) => {
    try {
        const userResult = await db_1.pool.query("SELECT id, name FROM users WHERE firebase_uid=$1", [req.user.uid]);
        const user = userResult.rows[0];
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const row = await getOrCreateKycRow(user.id);
        const currentStatus = overallStatus(row);
        if (isActiveApprovedKyc(row)) {
            await syncUserKycStatus(user.id, row);
            return res.json({
                success: true,
                alreadyVerified: true,
                message: "KYC already approved",
                overallStatus: currentStatus,
                kyc: publicKyc(row),
            });
        }
        if (String(row.aadhaar_status || "").toLowerCase() === "approved") {
            await syncUserKycStatus(user.id, row);
            return res.json({
                success: true,
                alreadyVerified: true,
                step: "aadhaar",
                message: "Aadhaar already verified",
                overallStatus: currentStatus,
                kyc: publicKyc(row),
            });
        }
        const provider = (process.env.KYC_PROVIDER || "kycaid").toLowerCase();
        const kycRequest = await (0, kyc_service_1.createKycRequest)(user);
        const verificationUrl = kycRequest.url ||
            kycRequest.verificationUrl ||
            kycRequest.verification_url ||
            kycRequest.form_url ||
            kycRequest.formUrl;
        if (!verificationUrl) {
            return res.status(502).json({
                success: false,
                message: `${provider} did not return verification URL`,
            });
        }
        const nerotixTxnId = kycRequest.id || kycRequest.txn_id || null;
        const nerotixRefId = kycRequest.reference_id || kycRequest.ref_id || null;
        const updatedKyc = await db_1.pool.query(`UPDATE kyc
       SET aadhaar_status='pending',
           status='PENDING',
           reference_id=COALESCE($1, reference_id),
           kycaid_form_url=$2,
           kyc_provider=$4,
           nerotix_txn_id=CASE WHEN $4='nerotix' THEN COALESCE($5, nerotix_txn_id) ELSE nerotix_txn_id END,
           nerotix_reference_id=CASE WHEN $4='nerotix' THEN COALESCE($6, nerotix_reference_id) ELSE nerotix_reference_id END,
           updated_at=NOW()
       WHERE id=$3
       RETURNING *`, [
            nerotixRefId || nerotixTxnId || kycRequest.form_token || null,
            verificationUrl,
            row.id,
            provider,
            nerotixTxnId,
            nerotixRefId,
        ]);
        if (provider === "nerotix") {
            scheduleNerotixAadhaarRefresh(updatedKyc.rows[0].id);
        }
        await db_1.pool.query(`UPDATE users
       SET kyc_status='PENDING',
           kyc_verified=false
       WHERE id=$1`, [user.id]);
        return res.json({
            success: true,
            verificationUrl,
            step: "aadhaar",
        });
    }
    catch (error) {
        const provider = (process.env.KYC_PROVIDER || "kycaid").toLowerCase();
        const providerError = error?.response?.data || error;
        console.error("KYC CREATE SESSION ERROR:", providerError);
        if (isKycProviderAuthFailure(error)) {
            return kycProviderUnavailable(res);
        }
        if (error?.message?.includes("NEROTIX_CREATE_SESSION_URL")) {
            return res.status(503).json({
                success: false,
                message: "Nerotix DigiLocker session URL is not configured",
                missing: "NEROTIX_CREATE_SESSION_URL",
                provider,
            });
        }
        if (error?.message?.includes("KYCAID_API_TOKEN")) {
            return res.status(503).json({
                success: false,
                message: "KYCaid credentials are not configured",
                provider,
            });
        }
        if (providerError?.message) {
            return res.status(error?.response?.status || 502).json({
                success: false,
                message: providerError.message,
                provider,
                providerStatusCode: providerError.statusCode,
            });
        }
        return res.status(500).json({
            success: false,
            message: "Failed to create KYC session",
            provider,
        });
    }
};
exports.createKycSession = createKycSession;
const verifyPan = async (req, res) => {
    try {
        const panNumber = String(req.body.panNumber || req.body.pan || "")
            .trim()
            .toUpperCase();
        if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid 10-character PAN number",
            });
        }
        const userResult = await db_1.pool.query("SELECT id, name FROM users WHERE firebase_uid=$1", [req.user.uid]);
        const user = userResult.rows[0];
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const row = await getOrCreateKycRow(user.id);
        const currentStatus = overallStatus(row);
        if (isActiveApprovedKyc(row)) {
            await syncUserKycStatus(user.id, row);
            return res.json({
                success: true,
                alreadyVerified: true,
                message: "KYC already approved",
                panStatus: row.pan_status,
                overallStatus: currentStatus,
                kyc: publicKyc(row),
            });
        }
        if (String(row.pan_status || "").toLowerCase() === "approved") {
            await syncUserKycStatus(user.id, row);
            return res.json({
                success: true,
                alreadyVerified: true,
                step: "pan",
                message: "PAN already verified",
                panStatus: row.pan_status,
                overallStatus: currentStatus,
                kyc: publicKyc(row),
            });
        }
        const provider = (process.env.KYC_PROVIDER || "kycaid").toLowerCase();
        if (provider !== "nerotix") {
            return res.status(400).json({
                success: false,
                message: "PAN verification is currently configured for Nerotix only",
            });
        }
        const payload = await (0, kyc_service_1.verifyNerotixPan)(panNumber);
        const data = payload?.data || {};
        const panStatus = String(data.pan_status || payload?.message || "").toLowerCase();
        const approved = payload?.success === true &&
            Number(payload?.statusCode) === 1 &&
            panStatus.includes("valid") &&
            !panStatus.includes("invalid");
        const rejected = payload?.success === false ||
            panStatus.includes("invalid") ||
            String(payload?.message || "").toLowerCase().includes("invalid");
        const nextStatus = approved ? "approved" : rejected ? "rejected" : "pending";
        const panValue = data.pan_number || panNumber;
        const result = await db_1.pool.query(`UPDATE kyc
       SET pan_status=$1,
           pan_reference_id=COALESCE($2, pan_reference_id),
           reference_id=COALESCE(reference_id, $2),
           pan_number=$3,
           pan_masked=$4,
           pan_name=$5,
           pan_payload=$6,
           kyc_provider='nerotix',
           status=CASE
             WHEN $1='rejected' THEN 'rejected'
             WHEN $1='approved' AND aadhaar_status='approved' THEN 'full'
             ELSE 'pending'
           END,
           updated_at=NOW()
       WHERE id=$7
       RETURNING *`, [
            nextStatus,
            data.txn_id || payload?.txn_id || null,
            panValue,
            maskPan(panValue),
            data.registered_name || null,
            payload,
            row.id,
        ]);
        const kyc = result.rows[0];
        const userKycStatus = await syncUserKycStatus(user.id, kyc);
        return res.json({
            success: approved,
            message: approved
                ? "PAN verified successfully"
                : rejected
                    ? "PAN verification failed"
                    : "PAN verification is pending",
            panStatus: nextStatus,
            overallStatus: userKycStatus,
            kyc: publicKyc(kyc),
        });
    }
    catch (error) {
        const providerError = error?.response?.data || error;
        console.error("PAN VERIFY ERROR:", providerError);
        if (isKycProviderAuthFailure(error)) {
            return kycProviderUnavailable(res);
        }
        return res.status(error?.response?.status || 500).json({
            success: false,
            message: providerError?.message || "Failed to verify PAN",
        });
    }
};
exports.verifyPan = verifyPan;
const kycaidCallback = async (req, res) => {
    try {
        // KYCAID sends no verifiable signature by default in this integration, and this
        // endpoint has no auth middleware (it must accept unauthenticated provider
        // webhooks). Without a shared secret, anyone could POST an arbitrary
        // { external_applicant_id, verified: true } and get instant KYC approval for
        // any user. Fail closed: require KYCAID_WEBHOOK_SECRET to be configured and
        // matched before trusting anything in the body. Configure the same value as a
        // query param or header on the webhook URL in the KYCAID dashboard.
        const expectedSecret = process.env.KYCAID_WEBHOOK_SECRET?.trim();
        const providedSecret = String(req.query.token || req.query.secret || req.headers["x-kycaid-secret"] || "").trim();
        if (!expectedSecret || providedSecret !== expectedSecret) {
            console.error("KYCAID CALLBACK REJECTED: missing or invalid webhook secret");
            return res.status(401).json({ success: false, received: false, reason: "invalid_secret" });
        }
        const payload = req.body || {};
        const externalApplicantId = payload.applicant?.external_applicant_id ||
            payload.external_applicant_id ||
            payload.externalApplicantId;
        const userId = Number(externalApplicantId);
        if (!userId) {
            return res.json({ success: true, received: false, reason: "missing_external_applicant_id" });
        }
        const verified = payload.verified;
        const status = verified === true || verified === "true"
            ? "APPROVED"
            : verified === false || verified === "false"
                ? "REJECTED"
                : "PENDING";
        const legacyKycStatus = status === "APPROVED" ? "full" : status === "REJECTED" ? "rejected" : "pending";
        const applicantId = payload.applicant_id ||
            payload.applicant?.applicant_id ||
            payload.applicant?.id ||
            null;
        const verificationId = payload.verification_id || payload.verification?.id || null;
        const stepStatus = status.toLowerCase();
        await db_1.pool.query(`UPDATE kyc
       SET aadhaar_status=$1,
           pan_status=$1,
           status=$2,
           kyc_expires_at=CASE WHEN $2='APPROVED' THEN NOW() + ($7::text || ' days')::interval ELSE kyc_expires_at END,
           reference_id=COALESCE($3, reference_id),
           kycaid_applicant_id=COALESCE($3, kycaid_applicant_id),
           kycaid_verification_id=COALESCE($4, kycaid_verification_id),
           kycaid_payload=$5,
           updated_at=NOW()
       WHERE user_id=$6`, [stepStatus, status, applicantId, verificationId, payload, userId, kycValidityDays]);
        await db_1.pool.query(`UPDATE users
       SET kyc_status=$1,
           kyc_verified=$2,
           kycaid_applicant_id=COALESCE($3, kycaid_applicant_id),
           kycaid_verification_id=COALESCE($4, kycaid_verification_id),
           kyc_completed_at=CASE WHEN $2 THEN NOW() ELSE kyc_completed_at END
       WHERE id=$5`, [legacyKycStatus, status === "APPROVED", applicantId, verificationId, userId]);
        return res.json({ success: true });
    }
    catch (error) {
        console.error("KYCAID CALLBACK ERROR:", error);
        return res.json({ success: true, received: false });
    }
};
exports.kycaidCallback = kycaidCallback;
const nerotixCallback = async (req, res) => {
    try {
        const payload = req.body || {};
        const externalUserId = payload.external_user_id ||
            payload.user_id ||
            payload.client_user_id ||
            payload.data?.external_user_id ||
            payload.data?.user_id;
        const parsedUserId = Number(externalUserId);
        const userId = Number.isInteger(parsedUserId) && parsedUserId > 0 ? parsedUserId : 0;
        const referenceId = payload.id ||
            payload.request_id ||
            payload.verification_id ||
            payload.txn_id ||
            payload.ref_id ||
            payload.data?.id ||
            payload.data?.request_id ||
            payload.data?.txn_id ||
            payload.data?.ref_id ||
            null;
        const matched = await db_1.pool.query(`SELECT *
       FROM kyc
       WHERE kyc_provider='nerotix'
         AND (
           ($1::text IS NOT NULL AND (
             nerotix_txn_id=$1
             OR nerotix_reference_id=$1
             OR reference_id=$1
             OR aadhaar_reference_id=$1
           ))
           OR ($2::int > 0 AND user_id=$2)
         )
       ORDER BY
         CASE WHEN $1::text IS NOT NULL AND (
           nerotix_txn_id=$1 OR nerotix_reference_id=$1 OR reference_id=$1
         ) THEN 0 ELSE 1 END,
         updated_at DESC NULLS LAST,
         created_at DESC
       LIMIT 1`, [referenceId ? String(referenceId) : null, userId]);
        const kyc = matched.rows[0];
        if (!kyc) {
            return res.json({ success: true, received: false, reason: "missing_user_match" });
        }
        const callbackStored = await db_1.pool.query(`UPDATE kyc
       SET reference_id=COALESCE($1, reference_id),
           nerotix_reference_id=COALESCE($1, nerotix_reference_id),
           nerotix_payload=$2,
           updated_at=NOW()
       WHERE id=$3
       RETURNING *`, [referenceId, payload, kyc.id]);
        const verified = await refreshNerotixAadhaarStatus(callbackStored.rows[0]);
        if (String(verified?.aadhaar_status || "").toLowerCase() === "pending") {
            scheduleNerotixAadhaarRefresh(verified.id);
        }
        return res.json({
            success: true,
            received: true,
            verified: String(verified?.aadhaar_status || "").toLowerCase() === "approved",
        });
    }
    catch (error) {
        console.error("NEROTIX CALLBACK ERROR:", error);
        return res.json({ success: true, received: false });
    }
};
exports.nerotixCallback = nerotixCallback;
const getMyKyc = async (req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT *
       FROM kyc
       WHERE user_id = (SELECT id FROM users WHERE firebase_uid=$1)
       ORDER BY
         CASE
           WHEN status IN ('full','approved','APPROVED')
             OR (aadhaar_status='approved' AND pan_status='approved')
           THEN 0 ELSE 1
         END,
         updated_at DESC NULLS LAST,
         created_at DESC
       LIMIT 1`, [req.user.uid]);
        let kyc = result.rows[0] || null;
        if (kyc) {
            kyc = await refreshNerotixAadhaarStatus(kyc);
        }
        if (kyc && isKycExpired(kyc) && isApprovedStatus(overallStatus(kyc))) {
            const expired = await db_1.pool.query(`UPDATE kyc
         SET status='expired',
             updated_at=NOW()
         WHERE id=$1
         RETURNING *`, [kyc.id]);
            kyc = expired.rows[0];
            await db_1.pool.query(`UPDATE users
         SET kyc_status='expired',
             kyc_verified=false
         WHERE id=$1`, [kyc.user_id]);
        }
        else if (kyc && isPendingExpired(kyc)) {
            const expired = await db_1.pool.query(`UPDATE kyc
         SET status='expired',
             aadhaar_status='none',
             pan_status='none',
             video_status='none',
             updated_at=NOW()
         WHERE id=$1
         RETURNING *`, [kyc.id]);
            kyc = expired.rows[0];
            await db_1.pool.query(`UPDATE users
         SET kyc_status='expired',
             kyc_verified=false
         WHERE id=$1`, [kyc.user_id]);
        }
        res.json(kyc
            ? {
                ...publicKyc(kyc),
                overallStatus: isKycExpired(kyc) && isApprovedStatus(overallStatus(kyc)) ? "expired" : overallStatus(kyc),
                canRetry: !isActiveApprovedKyc(kyc),
            }
            : null);
    }
    catch (error) {
        console.error("GET MY KYC ERROR:", error);
        res.status(500).json({ error: "Failed to fetch KYC" });
    }
};
exports.getMyKyc = getMyKyc;
