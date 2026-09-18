"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAugmontDirectBank = void 0;
const db_1 = require("../config/db");
const augmont_service_1 = require("./augmont.service");
const provider_payload_1 = require("../utils/provider-payload");
const providerBankId = (value) => String((0, provider_payload_1.readDeep)(value, ["userBankId", "user_bank_id", "bankId", "bank_id", "id"]) || "");
const bankMatches = (providerBank, account) => {
    const providerNumber = String((0, provider_payload_1.readDeep)(providerBank, ["accountNumber", "account_number", "bankAccountNumber"]) || "");
    const providerIfsc = (0, provider_payload_1.normalizeIfsc)((0, provider_payload_1.readDeep)(providerBank, ["ifscCode", "ifsc_code", "ifsc"]));
    const expectedLast4 = (0, provider_payload_1.accountLast4)(account.account_number);
    return (Boolean(expectedLast4) &&
        (0, provider_payload_1.accountLast4)(providerNumber) === expectedLast4 &&
        Boolean(providerIfsc) &&
        providerIfsc === (0, provider_payload_1.normalizeIfsc)(account.ifsc));
};
const findMatchingProviderBank = (payload, account) => (0, provider_payload_1.readDeepArray)(payload, ["banks", "userBanks", "user_banks", "data"]).find((row) => bankMatches(row, account));
const verifiedBankForUser = async (userId) => {
    const result = await db_1.pool.query(`SELECT id, account_holder_name, verified_account_holder_name,
            account_number, ifsc, bank_name, augmont_user_bank_id
     FROM withdrawal_accounts
     WHERE user_id=$1
       AND preferred_method='bank'
       AND bank_verified=true
       AND bank_verification_status='verified'
       AND status='verified'
     ORDER BY updated_at DESC
     LIMIT 1`, [userId]);
    const account = result.rows[0];
    if (!account || !account.account_number || !account.ifsc) {
        const error = new Error("Add and verify a bank account before selling digital gold");
        error.code = "VERIFIED_BANK_REQUIRED";
        throw error;
    }
    return account;
};
const ensureAugmontDirectBank = async (userId, uniqueId) => {
    const account = await verifiedBankForUser(userId);
    const accountName = String(account.verified_account_holder_name || account.account_holder_name || "").trim();
    if (!accountName)
        throw new Error("Verified bank holder name is unavailable");
    try {
        const listed = await (0, augmont_service_1.augmontGetUserBanks)(uniqueId);
        let matched = findMatchingProviderBank(listed, account);
        let syncPayload = listed;
        if (!matched) {
            const created = await (0, augmont_service_1.augmontCreateUserBank)(uniqueId, {
                accountName,
                accountNumber: account.account_number,
                ifscCode: (0, provider_payload_1.normalizeIfsc)(account.ifsc),
            });
            syncPayload = created;
            matched = bankMatches(created, account) ? created : undefined;
            if (!matched || !providerBankId(matched)) {
                const refreshed = await (0, augmont_service_1.augmontGetUserBanks)(uniqueId);
                syncPayload = refreshed;
                matched = findMatchingProviderBank(refreshed, account);
            }
        }
        const userBankId = providerBankId(matched);
        if (!userBankId) {
            throw new Error("Augmont did not return a bank reference for the verified account");
        }
        await db_1.pool.query(`UPDATE withdrawal_accounts
       SET augmont_user_bank_id=$1,
           augmont_bank_synced_at=NOW(),
           augmont_bank_payload=$2,
           augmont_bank_sync_error=NULL,
           updated_at=NOW()
       WHERE id=$3`, [userBankId, (0, provider_payload_1.redactProviderPayload)(syncPayload), account.id]);
        return {
            withdrawalAccountId: Number(account.id),
            userBankId,
            accountName,
            accountNumber: String(account.account_number),
            ifscCode: (0, provider_payload_1.normalizeIfsc)(account.ifsc),
            bankName: String(account.bank_name || ""),
            accountLast4: (0, provider_payload_1.accountLast4)(account.account_number),
        };
    }
    catch (error) {
        await db_1.pool
            .query(`UPDATE withdrawal_accounts
         SET augmont_bank_sync_error=$1, updated_at=NOW()
         WHERE id=$2`, [String(error?.message || error), account.id])
            .catch(() => null);
        throw error;
    }
};
exports.ensureAugmontDirectBank = ensureAugmontDirectBank;
