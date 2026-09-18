"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAppSetting = exports.getAppSettings = exports.updateWithdrawalRequestStatus = exports.getAllWithdrawalRequests = exports.updateWithdrawalAccountStatus = exports.getAllWithdrawalAccounts = exports.getMyWithdrawalRequests = exports.createWithdrawalRequest = exports.reverifyWithdrawalAccount = exports.upsertWithdrawalAccount = exports.getWithdrawalAccount = exports.getPayoutCapabilities = void 0;
const crypto_1 = require("crypto");
const db_1 = require("../config/db");
const augmont_merchant_policy_1 = require("../utils/augmont-merchant-policy");
const nerotixBank_service_1 = require("../services/nerotixBank.service");
const investment_kyc_service_1 = require("../services/investment-kyc.service");
const getUserId = async (firebaseUid) => {
    const result = await db_1.pool.query("SELECT id FROM users WHERE firebase_uid=$1 LIMIT 1", [firebaseUid]);
    return result.rows[0]?.id;
};
const createAuditLog = async (action, entityType, entityId, metadata = {}) => {
    await db_1.pool
        .query(`INSERT INTO admin_audit_logs (action, entity_type, entity_id, metadata)
       VALUES ($1,$2,$3,$4)`, [action, entityType, entityId, metadata])
        .catch(() => null);
};
const maskAccountNumber = (value) => {
    const accountNumber = String(value || "").replace(/\s+/g, "");
    if (!accountNumber)
        return "";
    if (accountNumber.length <= 4)
        return accountNumber;
    return `${"*".repeat(Math.min(accountNumber.length - 4, 8))}${accountNumber.slice(-4)}`;
};
const providerErrorMessage = (error) => String(error?.response?.data?.message ||
    error?.message ||
    "Bank verification could not be completed");
const getExpectedAccountName = async (userId) => {
    const result = await db_1.pool.query(`SELECT u.name, latest_kyc.pan_name, latest_kyc.pan_status
     FROM users u
     LEFT JOIN LATERAL (
       SELECT pan_name, pan_status
       FROM kyc
       WHERE user_id=u.id
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1
     ) latest_kyc ON true
     WHERE u.id=$1
     LIMIT 1`, [userId]);
    const row = result.rows[0] || {};
    const panApproved = String(row.pan_status || "").toLowerCase() === "approved" &&
        String(row.pan_name || "").trim();
    return {
        name: String(panApproved ? row.pan_name : row.name || "").trim(),
        source: panApproved ? "verified_pan" : "profile",
    };
};
const publicAccount = (row, includeFullNumber = false) => {
    if (!row)
        return null;
    const { bank_verification_payload: _providerPayload, ...account } = row;
    return {
        ...account,
        account_number: includeFullNumber
            ? String(row.account_number || "")
            : maskAccountNumber(row.account_number),
    };
};
const publicWithdrawalRequest = (row) => {
    if (!row)
        return null;
    const status = String(row.status || "pending").toLowerCase();
    const payoutReference = String(row.processed_reference || row.provider_reference || "").trim();
    const payoutCompleted = status === "paid" && Boolean(payoutReference) && Boolean(row.completed_at);
    const displayStatus = payoutCompleted
        ? "paid"
        : status === "paid"
            ? "payout_review"
            : status === "processing"
                ? "bank_transfer_pending"
                : status === "pending"
                    ? "awaiting_payout"
                    : status;
    return {
        ...row,
        payout_completed: payoutCompleted,
        display_status: displayStatus,
    };
};
const verifyAndPersistBankAccount = async (accountId, userId) => {
    const accountResult = await db_1.pool.query(`SELECT id, account_number, ifsc, bank_name
     FROM withdrawal_accounts
     WHERE id=$1 AND user_id=$2
     LIMIT 1`, [accountId, userId]);
    const account = accountResult.rows[0];
    if (!account) {
        const error = new Error("Withdrawal account not found");
        error.code = "WITHDRAWAL_ACCOUNT_NOT_FOUND";
        throw error;
    }
    try {
        const verification = await (0, nerotixBank_service_1.verifyBankAccountWithNerotix)(String(account.account_number || ""), String(account.ifsc || ""));
        const expectedName = await getExpectedAccountName(userId);
        const nameMatchStatus = (0, nerotixBank_service_1.compareAccountHolderName)(expectedName.name, String(verification.accountHolderName || ""));
        const verified = verification.accountValid && nameMatchStatus === "matched";
        const accountStatus = !verification.accountValid
            ? "verification_failed"
            : verified
                ? "verified"
                : "manual_review";
        const bankVerificationStatus = !verification.accountValid
            ? "invalid"
            : verified
                ? "verified"
                : "name_mismatch";
        const verificationError = !verification.accountValid
            ? verification.providerMessage ||
                "Nerotix reported this bank account as invalid"
            : verified
                ? null
                : `Bank holder name does not match the ${expectedName.source === "verified_pan" ? "verified PAN name" : "profile name"}`;
        const updated = await db_1.pool.query(`UPDATE withdrawal_accounts
       SET verification_provider='nerotix',
           bank_verified=$1,
           upi_verified=false,
           status=$2,
           bank_verification_status=$3,
           bank_verification_reference=$4,
           bank_verification_utr=$5,
           verified_account_holder_name=$6,
           bank_verification_payload=$7,
           bank_verification_error=$8,
           bank_verified_at=CASE WHEN $1 THEN NOW() ELSE NULL END,
           name_match_status=$9,
           bank_name=CASE
             WHEN COALESCE(NULLIF(bank_name, ''), '')='' AND COALESCE($10, '')<>''
             THEN $10
             ELSE bank_name
           END,
           updated_at=NOW()
       WHERE id=$11
       RETURNING *`, [
            verified,
            accountStatus,
            bankVerificationStatus,
            verification.transactionId,
            verification.utr,
            verification.accountHolderName,
            verification.evidence,
            verificationError,
            nameMatchStatus,
            verification.bankName,
            accountId,
        ]);
        return {
            attempted: true,
            verified,
            accountValid: verification.accountValid,
            status: bankVerificationStatus,
            message: verificationError ||
                "Bank account and account holder name verified successfully",
            transactionId: verification.transactionId,
            utr: verification.utr,
            accountHolderName: verification.accountHolderName,
            nameMatchStatus,
            expectedNameSource: expectedName.source,
            account: updated.rows[0],
        };
    }
    catch (error) {
        const message = providerErrorMessage(error);
        const evidence = error?.providerPayload || null;
        const updated = await db_1.pool.query(`UPDATE withdrawal_accounts
       SET verification_provider='nerotix',
           bank_verified=false,
           upi_verified=false,
           status='provider_error',
           bank_verification_status='provider_error',
           bank_verification_payload=COALESCE($1, bank_verification_payload),
           bank_verification_error=$2,
           bank_verified_at=NULL,
           name_match_status='not_checked',
           updated_at=NOW()
       WHERE id=$3
       RETURNING *`, [evidence, message, accountId]);
        return {
            attempted: true,
            verified: false,
            accountValid: false,
            status: "provider_error",
            message,
            code: error?.code || "NEROTIX_BANK_VERIFY_FAILED",
            account: updated.rows[0],
        };
    }
};
const getPayoutCapabilities = async (_req, res) => res.json({
    bankVerification: {
        provider: "nerotix",
        enabled: Boolean(String(process.env.NEROTIX_API_TOKEN || "").trim()),
    },
    payouts: {
        method: "bank",
        provider: "manual",
        automated: false,
        code: "NEROTIX_DMT_CONTRACT_REQUIRED",
    },
});
exports.getPayoutCapabilities = getPayoutCapabilities;
const getWithdrawalAccount = async (req, res) => {
    try {
        const userId = await getUserId(req.user?.uid);
        if (!userId)
            return res.status(404).json({ message: "User not found" });
        const result = await db_1.pool.query(`SELECT id, account_holder_name, bank_name, account_number, ifsc,
              preferred_method, bank_verified, status, verification_provider,
              bank_verification_status, bank_verification_reference,
              bank_verification_utr, verified_account_holder_name,
              bank_verification_error, bank_verified_at, name_match_status,
              modification_count, updated_at
       FROM withdrawal_accounts
       WHERE user_id=$1
       ORDER BY updated_at DESC
       LIMIT 1`, [userId]);
        return res.json(publicAccount(result.rows[0], true));
    }
    catch (error) {
        console.error("GET WITHDRAWAL ACCOUNT ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch withdrawal account" });
    }
};
exports.getWithdrawalAccount = getWithdrawalAccount;
const upsertWithdrawalAccount = async (req, res) => {
    try {
        const userId = await getUserId(req.user?.uid);
        if (!userId)
            return res.status(404).json({ message: "User not found" });
        const preferredMethod = String(req.body.preferredMethod || req.body.preferred_method || "bank").toLowerCase();
        if (preferredMethod !== "bank") {
            return res.status(400).json({
                message: "UPI payout verification is not available. Add a bank account.",
                code: "UPI_PAYOUT_NOT_AVAILABLE",
            });
        }
        const accountHolderName = String(req.body.accountHolderName || req.body.account_holder_name || "").trim();
        const bankName = String(req.body.bankName || req.body.bank_name || "").trim();
        const accountNumber = String(req.body.accountNumber || req.body.account_number || "")
            .replace(/\s+/g, "")
            .trim();
        const ifsc = String(req.body.ifsc || "").trim().toUpperCase();
        if (!accountHolderName || !accountNumber || !ifsc) {
            return res.status(400).json({
                message: "Account holder name, account number and IFSC are required",
            });
        }
        if (!/^\d{6,20}$/.test(accountNumber)) {
            return res.status(400).json({ message: "Enter a valid bank account number" });
        }
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
            return res.status(400).json({ message: "Enter a valid IFSC code" });
        }
        const accountDb = await db_1.pool.connect();
        let saved;
        let accountCommitted = false;
        try {
            await accountDb.query("BEGIN");
            await accountDb.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
            const sameAccount = await accountDb.query(`SELECT id, ifsc, modification_count
       FROM withdrawal_accounts
       WHERE user_id=$1 AND account_number=$2
       ORDER BY updated_at DESC
       LIMIT 1`, [userId, accountNumber]);
            if (sameAccount.rows.length && String(sameAccount.rows[0].ifsc || "").toUpperCase() !== ifsc) {
                return res.status(409).json({
                    code: "BANK_ACCOUNT_IFSC_MISMATCH",
                    message: "This account number is already registered with a different IFSC and cannot be reused.",
                });
            }
            if (!sameAccount.rows.length) {
                const ownedByOther = await accountDb.query(`SELECT id FROM withdrawal_accounts
         WHERE account_number=$1 AND user_id<>$2
         LIMIT 1`, [accountNumber, userId]);
                if (ownedByOther.rows.length) {
                    return res.status(409).json({
                        code: "BANK_ACCOUNT_ALREADY_REGISTERED",
                        message: "This account number is already registered to another customer and cannot be reused.",
                    });
                }
            }
            const accountCount = await accountDb.query("SELECT COUNT(*)::int AS count FROM withdrawal_accounts WHERE user_id=$1", [userId]);
            const existing = sameAccount.rows[0];
            if (!existing && Number(accountCount.rows[0]?.count || 0) >= augmont_merchant_policy_1.augmontMerchantPolicy.maximumBankIds) {
                return res.status(409).json({
                    code: "BANK_ID_LIMIT_REACHED",
                    message: `A maximum of ${augmont_merchant_policy_1.augmontMerchantPolicy.maximumBankIds} bank accounts can be registered.`,
                });
            }
            if (existing && Number(existing.modification_count || 0) >= augmont_merchant_policy_1.augmontMerchantPolicy.maximumBankModifications) {
                return res.status(409).json({
                    code: "BANK_MODIFICATION_LIMIT_REACHED",
                    message: `This bank account has reached its ${augmont_merchant_policy_1.augmontMerchantPolicy.maximumBankModifications}-modification limit.`,
                });
            }
            saved = existing
                ? await accountDb.query(`UPDATE withdrawal_accounts
           SET account_holder_name=$1, bank_name=$2, account_number=$3, ifsc=$4,
               upi_id='', preferred_method='bank', bank_verified=false,
               upi_verified=false, status='pending',
               verification_provider='nerotix',
               bank_verification_status='pending',
               bank_verification_reference=NULL,
               bank_verification_utr=NULL,
               verified_account_holder_name=NULL,
               bank_verification_payload=NULL,
               bank_verification_error=NULL,
               bank_verified_at=NULL,
               name_match_status='not_checked',
               augmont_user_bank_id=NULL,
               augmont_bank_synced_at=NULL,
               augmont_bank_payload=NULL,
               augmont_bank_sync_error=NULL,
               modification_count=modification_count+1,
               updated_at=NOW()
           WHERE id=$5
           RETURNING *`, [
                    accountHolderName,
                    bankName,
                    accountNumber,
                    ifsc,
                    existing.id,
                ])
                : await accountDb.query(`INSERT INTO withdrawal_accounts
           (user_id, account_holder_name, bank_name, account_number, ifsc,
            upi_id, preferred_method, bank_verified, upi_verified, status,
            verification_provider, bank_verification_status, name_match_status)
           VALUES ($1,$2,$3,$4,$5,'','bank',false,false,'pending',
                   'nerotix','pending','not_checked')
           RETURNING *`, [userId, accountHolderName, bankName, accountNumber, ifsc]);
            await accountDb.query("COMMIT");
            accountCommitted = true;
        }
        finally {
            try {
                if (!accountCommitted)
                    await accountDb.query("ROLLBACK");
            }
            finally {
                accountDb.release();
            }
        }
        const verification = await verifyAndPersistBankAccount(saved.rows[0].id, userId);
        return res.json({
            success: true,
            account: publicAccount(verification.account, true),
            verification: {
                attempted: verification.attempted,
                verified: verification.verified,
                accountValid: verification.accountValid,
                status: verification.status,
                message: verification.message,
                transactionId: verification.transactionId || null,
                utr: verification.utr || null,
                accountHolderName: verification.accountHolderName || null,
                nameMatchStatus: verification.nameMatchStatus || "not_checked",
            },
        });
    }
    catch (error) {
        console.error("SAVE WITHDRAWAL ACCOUNT ERROR:", error);
        return res.status(500).json({ message: "Failed to save withdrawal account" });
    }
};
exports.upsertWithdrawalAccount = upsertWithdrawalAccount;
const reverifyWithdrawalAccount = async (req, res) => {
    try {
        const account = await db_1.pool.query("SELECT id, user_id FROM withdrawal_accounts WHERE id=$1 LIMIT 1", [req.params.id]);
        if (!account.rows.length) {
            return res.status(404).json({ message: "Withdrawal account not found" });
        }
        const verification = await verifyAndPersistBankAccount(account.rows[0].id, account.rows[0].user_id);
        await createAuditLog("withdrawal_account_provider_recheck", "withdrawal_account", String(req.params.id), {
            provider: "nerotix",
            verified: verification.verified,
            status: verification.status,
            transactionId: verification.transactionId || null,
        });
        return res.json({
            success: true,
            account: publicAccount(verification.account),
            verification: {
                attempted: verification.attempted,
                verified: verification.verified,
                accountValid: verification.accountValid,
                status: verification.status,
                message: verification.message,
                transactionId: verification.transactionId || null,
                utr: verification.utr || null,
                accountHolderName: verification.accountHolderName || null,
                nameMatchStatus: verification.nameMatchStatus || "not_checked",
            },
        });
    }
    catch (error) {
        console.error("REVERIFY WITHDRAWAL ACCOUNT ERROR:", error);
        return res.status(500).json({ message: "Failed to recheck withdrawal account" });
    }
};
exports.reverifyWithdrawalAccount = reverifyWithdrawalAccount;
const getWithdrawalSettings = async () => {
    const result = await db_1.pool.query("SELECT value FROM app_settings WHERE key='withdrawal'");
    const value = result.rows[0]?.value || {};
    return {
        minWithdrawal: Number(value.minWithdrawal || 100),
    };
};
const createWithdrawalRequest = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        const userId = await getUserId(req.user?.uid);
        if (!userId)
            return res.status(404).json({ message: "User not found" });
        const requestedAmount = Number(req.body.amount);
        if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
            return res.status(400).json({ message: "Invalid withdrawal amount" });
        }
        const amount = Number(requestedAmount.toFixed(2));
        if (Math.abs(amount - requestedAmount) > 0.0001) {
            return res.status(400).json({
                message: "Withdrawal amount can have at most two decimal places",
            });
        }
        const method = String(req.body.method || "bank").toLowerCase();
        if (method !== "bank") {
            return res.status(400).json({
                message: "Withdrawals are currently available to verified bank accounts only",
                code: "UPI_PAYOUT_NOT_AVAILABLE",
            });
        }
        // Reuses the same expiry-aware eligibility check that gates buy/sell, instead
        // of reading the denormalized users.kyc_status cache directly: that cache is
        // only refreshed as a side effect of visiting the KYC/investment screens, so
        // an expired KYC could otherwise still read as "full" here indefinitely.
        const eligibility = await (0, investment_kyc_service_1.getInvestmentKycEligibility)(req.user?.uid || "");
        if (!eligibility.approved) {
            return res.status(403).json({ message: "Complete KYC before withdrawal" });
        }
        const settings = await getWithdrawalSettings();
        if (amount < settings.minWithdrawal) {
            return res.status(400).json({
                message: `Minimum withdrawal is Rs.${settings.minWithdrawal}`,
            });
        }
        const account = await db_1.pool.query(`SELECT id, bank_verified, bank_verification_status, status
       FROM withdrawal_accounts
       WHERE user_id=$1
       ORDER BY updated_at DESC
       LIMIT 1`, [userId]);
        const withdrawalAccount = account.rows[0];
        if (!withdrawalAccount) {
            return res.status(403).json({
                message: "Add and verify a bank account before withdrawal",
            });
        }
        if (withdrawalAccount.bank_verified !== true ||
            String(withdrawalAccount.bank_verification_status) !== "verified" ||
            String(withdrawalAccount.status) !== "verified") {
            return res.status(403).json({
                message: "Bank account verification is not complete",
            });
        }
        const suppliedIdempotencyKey = String(req.body.clientRequestId || req.body.idempotencyKey || "").trim();
        if (suppliedIdempotencyKey &&
            !/^[A-Za-z0-9._:-]{8,100}$/.test(suppliedIdempotencyKey)) {
            return res.status(400).json({ message: "Invalid request reference" });
        }
        const idempotencyKey = suppliedIdempotencyKey || (0, crypto_1.randomUUID)();
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            `${userId}:${idempotencyKey}`,
        ]);
        const replay = await client.query(`SELECT *
       FROM withdrawal_requests
       WHERE user_id=$1 AND idempotency_key=$2
       LIMIT 1`, [userId, idempotencyKey]);
        if (replay.rows.length) {
            const replayRequest = publicWithdrawalRequest(replay.rows[0]);
            const balances = await client.query(`SELECT COALESCE(balance,0) AS balance,
                COALESCE(reserved_balance,0) AS reserved_balance
         FROM wallets WHERE user_id=$1 LIMIT 1`, [userId]);
            await client.query("COMMIT");
            return res.json({
                success: true,
                idempotentReplay: true,
                payoutCompleted: replayRequest?.payout_completed === true,
                payoutStatus: replayRequest?.display_status,
                request: replayRequest,
                referenceId: `withdrawal:${replay.rows[0].id}`,
                availableBalance: Number(balances.rows[0]?.balance || 0),
                reservedBalance: Number(balances.rows[0]?.reserved_balance || 0),
                message: replayRequest?.payout_completed
                    ? "This withdrawal was already paid to the bank and has a settlement reference."
                    : "Withdrawal request already exists. No bank transfer has been confirmed; funds remain reserved.",
            });
        }
        await client.query(`INSERT INTO wallets (user_id, balance, reserved_balance)
       VALUES ($1,0,0)
       ON CONFLICT (user_id) DO NOTHING`, [userId]);
        const wallet = await client.query(`SELECT COALESCE(balance,0) AS balance,
              COALESCE(reserved_balance,0) AS reserved_balance
       FROM wallets WHERE user_id=$1 FOR UPDATE`, [userId]);
        const availableBalance = Number(wallet.rows[0]?.balance || 0);
        const reservedBalance = Number(wallet.rows[0]?.reserved_balance || 0);
        if (availableBalance < amount) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Insufficient wallet balance" });
        }
        const request = await client.query(`INSERT INTO withdrawal_requests
       (user_id, withdrawal_account_id, amount, method, status, provider,
        provider_status, idempotency_key)
       VALUES ($1,$2,$3,'bank','pending','manual','awaiting_payout',$4)
       RETURNING *`, [userId, withdrawalAccount.id, amount, idempotencyKey]);
        const referenceId = `withdrawal:${request.rows[0].id}`;
        await client.query(`UPDATE wallets
       SET balance=balance-$1,
           reserved_balance=COALESCE(reserved_balance,0)+$1
       WHERE user_id=$2`, [amount, userId]);
        await client.query(`INSERT INTO wallet_transactions
       (user_id, type, amount, method, reason, status, reference_id)
       VALUES ($1,'hold',$2,'withdrawal_bank',
               'Withdrawal funds reserved','pending',$3)`, [userId, amount, referenceId]);
        await client.query("COMMIT");
        return res.status(201).json({
            success: true,
            payoutCompleted: false,
            payoutStatus: "awaiting_payout",
            request: publicWithdrawalRequest(request.rows[0]),
            referenceId,
            availableBalance: availableBalance - amount,
            reservedBalance: reservedBalance + amount,
            message: "Withdrawal request submitted. No bank transfer has occurred; funds are reserved until a payout is completed and its reference is recorded.",
        });
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => null);
        console.error("CREATE WITHDRAWAL REQUEST ERROR:", error);
        return res.status(500).json({ message: "Failed to create withdrawal request" });
    }
    finally {
        client.release();
    }
};
exports.createWithdrawalRequest = createWithdrawalRequest;
const getMyWithdrawalRequests = async (req, res) => {
    try {
        const userId = await getUserId(req.user?.uid);
        if (!userId)
            return res.status(404).json({ message: "User not found" });
        const result = await db_1.pool.query(`SELECT id, amount, method, status, provider, provider_status,
              provider_reference, processed_reference, failure_reason,
              created_at, updated_at, initiated_at, completed_at
       FROM withdrawal_requests
       WHERE user_id=$1
       ORDER BY created_at DESC`, [userId]);
        return res.json(result.rows.map(publicWithdrawalRequest));
    }
    catch (error) {
        console.error("GET MY WITHDRAWALS ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch withdrawal requests" });
    }
};
exports.getMyWithdrawalRequests = getMyWithdrawalRequests;
const getAllWithdrawalAccounts = async (_req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT wa.id, wa.user_id, wa.account_holder_name, wa.bank_name,
              wa.account_number, wa.ifsc, wa.preferred_method,
              wa.bank_verified, wa.status, wa.verification_provider,
              wa.bank_verification_status, wa.bank_verification_reference,
              wa.bank_verification_utr, wa.verified_account_holder_name,
              wa.bank_verification_error, wa.bank_verified_at,
              wa.name_match_status, wa.updated_at, u.name, u.phone
       FROM withdrawal_accounts wa
       LEFT JOIN users u ON u.id=wa.user_id
       ORDER BY wa.updated_at DESC`);
        return res.json(result.rows.map((row) => publicAccount(row)));
    }
    catch (error) {
        console.error("GET ADMIN WITHDRAWAL ACCOUNTS ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch withdrawal accounts" });
    }
};
exports.getAllWithdrawalAccounts = getAllWithdrawalAccounts;
const updateWithdrawalAccountStatus = async (req, res) => {
    try {
        if (req.body.bankVerified === true ||
            req.body.bank_verified === true ||
            req.body.upiVerified === true ||
            req.body.upi_verified === true) {
            return res.status(400).json({
                message: "Verification must come from the bank verification provider",
            });
        }
        const status = String(req.body.status || "").toLowerCase();
        if (!["rejected", "disabled"].includes(status)) {
            return res.status(400).json({
                message: "Admin can only reject or disable a payout account",
            });
        }
        const reason = String(req.body.reason || req.body.adminNotes || req.body.admin_notes || "").trim();
        const result = await db_1.pool.query(`UPDATE withdrawal_accounts
       SET bank_verified=false, upi_verified=false, status=$1,
           bank_verification_error=COALESCE(NULLIF($2,''), bank_verification_error),
           bank_verified_at=NULL, updated_at=NOW()
       WHERE id=$3 RETURNING *`, [status, reason, req.params.id]);
        if (!result.rows.length) {
            return res.status(404).json({ message: "Withdrawal account not found" });
        }
        await createAuditLog("withdrawal_account_restricted", "withdrawal_account", String(req.params.id), { status, reason });
        return res.json({
            success: true,
            account: publicAccount(result.rows[0]),
        });
    }
    catch (error) {
        console.error("UPDATE WITHDRAWAL ACCOUNT ERROR:", error);
        return res.status(500).json({ message: "Failed to update withdrawal account" });
    }
};
exports.updateWithdrawalAccountStatus = updateWithdrawalAccountStatus;
const getAllWithdrawalRequests = async (_req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT wr.id, wr.user_id, wr.withdrawal_account_id, wr.amount,
              wr.method, wr.status, wr.admin_notes, wr.processed_reference,
              wr.provider, wr.provider_status, wr.provider_reference,
              wr.failure_reason, wr.initiated_at, wr.completed_at,
              wr.created_at, wr.updated_at, u.name, u.phone,
              wa.account_holder_name, wa.bank_name, wa.account_number, wa.ifsc
       FROM withdrawal_requests wr
       LEFT JOIN users u ON u.id=wr.user_id
       LEFT JOIN withdrawal_accounts wa ON wa.id=wr.withdrawal_account_id
       ORDER BY wr.created_at DESC`);
        return res.json(result.rows.map((row) => publicWithdrawalRequest({
            ...row,
            account_number: maskAccountNumber(row.account_number),
        })));
    }
    catch (error) {
        console.error("GET ADMIN WITHDRAWALS ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch withdrawal requests" });
    }
};
exports.getAllWithdrawalRequests = getAllWithdrawalRequests;
const updateWithdrawalRequestStatus = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        const status = String(req.body.status || "").toLowerCase();
        const requestedReference = String(req.body.processedReference ||
            req.body.processed_reference ||
            req.body.providerReference ||
            req.body.provider_reference ||
            "").trim();
        const adminNotes = String(req.body.adminNotes || req.body.admin_notes || "").trim();
        const paymentConfirmed = req.body.paymentConfirmed === true;
        if (!["pending", "processing", "paid", "failed", "rejected"].includes(status)) {
            return res.status(400).json({ message: "Invalid withdrawal status" });
        }
        await client.query("BEGIN");
        const existing = await client.query("SELECT * FROM withdrawal_requests WHERE id=$1 FOR UPDATE", [req.params.id]);
        const current = existing.rows[0];
        if (!current) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Withdrawal request not found" });
        }
        const currentStatus = String(current.status || "pending").toLowerCase();
        const payoutReference = requestedReference ||
            String(current.provider_reference || current.processed_reference || "").trim();
        const allowedTransitions = {
            pending: ["pending", "processing", "failed", "rejected"],
            processing: ["processing", "paid", "failed", "rejected"],
            paid: ["paid"],
            failed: ["failed"],
            rejected: ["rejected"],
        };
        if (!(allowedTransitions[currentStatus] || []).includes(status)) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: `Withdrawal cannot move from ${currentStatus} to ${status}`,
            });
        }
        if (status === "paid" && currentStatus !== "processing" && currentStatus !== "paid") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "Move the withdrawal to processing before recording payout",
            });
        }
        if (status === "paid" && (!payoutReference || !paymentConfirmed)) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                message: "Confirm the external bank payout and enter its reference before marking paid",
            });
        }
        const withdrawalReference = `withdrawal:${current.id}`;
        if (status === "paid" && currentStatus !== "paid") {
            const hold = await client.query(`SELECT id FROM wallet_transactions
         WHERE reference_id=$1 AND type='hold' AND status='pending'
         FOR UPDATE`, [withdrawalReference]);
            if (hold.rows.length) {
                const wallet = await client.query(`SELECT COALESCE(reserved_balance,0) AS reserved_balance
           FROM wallets WHERE user_id=$1 FOR UPDATE`, [current.user_id]);
                if (Number(wallet.rows[0]?.reserved_balance || 0) < Number(current.amount)) {
                    await client.query("ROLLBACK");
                    return res.status(409).json({
                        message: "Reserved wallet amount is inconsistent. Reconcile before payout.",
                    });
                }
                await client.query(`UPDATE wallets
           SET reserved_balance=GREATEST(COALESCE(reserved_balance,0)-$1,0)
           WHERE user_id=$2`, [current.amount, current.user_id]);
                await client.query(`UPDATE wallet_transactions
           SET type='debit', status='success', reason='Bank withdrawal paid'
           WHERE id=$1`, [hold.rows[0].id]);
            }
            else {
                const legacyDebit = await client.query(`UPDATE wallet_transactions SET status='success'
           WHERE reference_id=$1 AND type='debit' AND status='pending'
           RETURNING id`, [withdrawalReference]);
                if (!legacyDebit.rowCount) {
                    const settledLegacyDebit = await client.query(`SELECT id FROM wallet_transactions
             WHERE reference_id=$1 AND type='debit' AND status='success'
             LIMIT 1`, [withdrawalReference]);
                    if (!settledLegacyDebit.rows.length) {
                        await client.query("ROLLBACK");
                        return res.status(409).json({
                            message: "No matching wallet hold or debit exists. Reconcile before payout.",
                        });
                    }
                }
            }
        }
        if (["failed", "rejected"].includes(status) &&
            !["failed", "rejected"].includes(currentStatus)) {
            const hold = await client.query(`SELECT id FROM wallet_transactions
         WHERE reference_id=$1 AND type='hold' AND status='pending'
         FOR UPDATE`, [withdrawalReference]);
            if (hold.rows.length) {
                const wallet = await client.query(`SELECT COALESCE(reserved_balance,0) AS reserved_balance
           FROM wallets WHERE user_id=$1 FOR UPDATE`, [current.user_id]);
                if (Number(wallet.rows[0]?.reserved_balance || 0) < Number(current.amount)) {
                    await client.query("ROLLBACK");
                    return res.status(409).json({
                        message: "Reserved wallet amount is inconsistent. Reconcile before releasing funds.",
                    });
                }
                await client.query(`UPDATE wallets
           SET balance=balance+$1,
               reserved_balance=GREATEST(COALESCE(reserved_balance,0)-$1,0)
           WHERE user_id=$2`, [current.amount, current.user_id]);
                await client.query(`UPDATE wallet_transactions
           SET status='released', reason='Withdrawal hold released'
           WHERE id=$1`, [hold.rows[0].id]);
                await client.query(`INSERT INTO wallet_transactions
           (user_id, type, amount, method, reason, status, reference_id)
           SELECT $1,'credit',$2,'withdrawal_release',
                  'Withdrawal request released','success',$3
           WHERE NOT EXISTS (
             SELECT 1 FROM wallet_transactions
             WHERE reference_id=$3 AND type='credit'
           )`, [current.user_id, current.amount, `withdrawal_release:${current.id}`]);
            }
            else {
                const legacyDebit = await client.query(`UPDATE wallet_transactions SET status='failed'
           WHERE reference_id=$1 AND type='debit' AND status='pending'
           RETURNING id`, [withdrawalReference]);
                if (legacyDebit.rowCount) {
                    const refundReference = `withdrawal_refund:${current.id}`;
                    const refund = await client.query(`INSERT INTO wallet_transactions
             (user_id, type, amount, method, reason, status, reference_id)
             SELECT $1,'credit',$2,'withdrawal_refund',
                    'Legacy withdrawal request reversed','success',$3
             WHERE NOT EXISTS (
               SELECT 1 FROM wallet_transactions
               WHERE reference_id=$3 AND type='credit'
             )
             RETURNING id`, [current.user_id, current.amount, refundReference]);
                    if (refund.rowCount) {
                        await client.query("UPDATE wallets SET balance=balance+$1 WHERE user_id=$2", [current.amount, current.user_id]);
                    }
                }
            }
        }
        const providerStatus = status === "processing"
            ? "manual_processing"
            : status === "paid"
                ? "paid"
                : ["failed", "rejected"].includes(status)
                    ? status
                    : String(current.provider_status || "awaiting_payout");
        const result = await client.query(`UPDATE withdrawal_requests
       SET status=$1,
           admin_notes=COALESCE(NULLIF($2,''), admin_notes),
           processed_reference=CASE WHEN $1='paid' THEN $3 ELSE processed_reference END,
           provider='manual',
           provider_status=$4,
           provider_reference=CASE WHEN $1='paid' THEN $3 ELSE provider_reference END,
           initiated_at=CASE
             WHEN $1='processing' THEN COALESCE(initiated_at,NOW())
             ELSE initiated_at
           END,
           completed_at=CASE WHEN $1='paid' THEN NOW() ELSE completed_at END,
           failure_reason=CASE
             WHEN $1 IN ('failed','rejected') THEN COALESCE(NULLIF($2,''),$1)
             ELSE failure_reason
           END,
           updated_at=NOW()
       WHERE id=$5
       RETURNING *`, [status, adminNotes, payoutReference || null, providerStatus, req.params.id]);
        await client.query("COMMIT");
        await createAuditLog("withdrawal_request_update", "withdrawal_request", String(req.params.id), {
            from: currentStatus,
            to: status,
            provider: "manual",
            payoutReference: status === "paid" ? payoutReference : null,
        });
        const responseRequest = publicWithdrawalRequest(result.rows[0]);
        return res.json({
            success: true,
            payoutCompleted: responseRequest?.payout_completed === true,
            request: responseRequest,
            message: status === "paid"
                ? "External bank payout recorded with its settlement reference."
                : status === "processing"
                    ? "Status changed to processing. This action did not send money."
                    : ["failed", "rejected"].includes(status)
                        ? "Withdrawal closed and eligible reserved funds were returned to the wallet."
                        : "Withdrawal status updated. No bank payout has been confirmed.",
        });
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => null);
        console.error("WITHDRAWAL STATUS UPDATE ERROR:", error);
        return res.status(500).json({ message: "Failed to update withdrawal request" });
    }
    finally {
        client.release();
    }
};
exports.updateWithdrawalRequestStatus = updateWithdrawalRequestStatus;
const getAppSettings = async (_req, res) => {
    try {
        const result = await db_1.pool.query("SELECT key, value, updated_at FROM app_settings ORDER BY key");
        return res.json(result.rows);
    }
    catch {
        return res.status(500).json({ message: "Failed to fetch settings" });
    }
};
exports.getAppSettings = getAppSettings;
const updateAppSetting = async (req, res) => {
    try {
        const key = String(req.params.key || req.body.key || "").trim();
        if (!key)
            return res.status(400).json({ message: "Setting key required" });
        const value = req.body.value || req.body;
        const result = await db_1.pool.query(`INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (key)
       DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
       RETURNING *`, [key, value]);
        await createAuditLog("app_setting_update", "app_setting", key, value);
        return res.json({ success: true, setting: result.rows[0] });
    }
    catch {
        return res.status(500).json({ message: "Failed to update setting" });
    }
};
exports.updateAppSetting = updateAppSetting;
