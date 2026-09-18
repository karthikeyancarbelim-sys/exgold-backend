import { pool } from "../config/db";
import {
  augmontCreateUserBank,
  augmontGetUserBanks,
} from "./augmont.service";
import {
  accountLast4,
  normalizeIfsc,
  readDeep,
  readDeepArray,
  redactProviderPayload,
} from "../utils/provider-payload";

type VerifiedBankRow = {
  id: number;
  account_holder_name: string;
  verified_account_holder_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
  augmont_user_bank_id?: string;
};

export type AugmontDirectBank = {
  withdrawalAccountId: number;
  userBankId: string;
  accountName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  accountLast4: string;
};

const providerBankId = (value: any) =>
  String(readDeep(value, ["userBankId", "user_bank_id", "bankId", "bank_id", "id"]) || "");

const bankMatches = (providerBank: any, account: VerifiedBankRow) => {
  const providerNumber = String(
    readDeep(providerBank, ["accountNumber", "account_number", "bankAccountNumber"]) || ""
  );
  const providerIfsc = normalizeIfsc(
    readDeep(providerBank, ["ifscCode", "ifsc_code", "ifsc"])
  );
  const expectedLast4 = accountLast4(account.account_number);
  return (
    Boolean(expectedLast4) &&
    accountLast4(providerNumber) === expectedLast4 &&
    Boolean(providerIfsc) &&
    providerIfsc === normalizeIfsc(account.ifsc)
  );
};

const findMatchingProviderBank = (payload: any, account: VerifiedBankRow) =>
  readDeepArray(payload, ["banks", "userBanks", "user_banks", "data"]).find((row) =>
    bankMatches(row, account)
  );

const verifiedBankForUser = async (userId: number) => {
  const result = await pool.query(
    `SELECT id, account_holder_name, verified_account_holder_name,
            account_number, ifsc, bank_name, augmont_user_bank_id
     FROM withdrawal_accounts
     WHERE user_id=$1
       AND preferred_method='bank'
       AND bank_verified=true
       AND bank_verification_status='verified'
       AND status='verified'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId]
  );
  const account = result.rows[0] as VerifiedBankRow | undefined;
  if (!account || !account.account_number || !account.ifsc) {
    const error = new Error("Add and verify a bank account before selling digital gold");
    (error as any).code = "VERIFIED_BANK_REQUIRED";
    throw error;
  }
  return account;
};

export const ensureAugmontDirectBank = async (
  userId: number,
  uniqueId: string
): Promise<AugmontDirectBank> => {
  const account = await verifiedBankForUser(userId);
  const accountName = String(
    account.verified_account_holder_name || account.account_holder_name || ""
  ).trim();
  if (!accountName) throw new Error("Verified bank holder name is unavailable");

  try {
    const listed = await augmontGetUserBanks(uniqueId);
    let matched = findMatchingProviderBank(listed, account);
    let syncPayload: any = listed;

    if (!matched) {
      const created = await augmontCreateUserBank(uniqueId, {
        accountName,
        accountNumber: account.account_number,
        ifscCode: normalizeIfsc(account.ifsc),
      });
      syncPayload = created;
      matched = bankMatches(created, account) ? created : undefined;

      if (!matched || !providerBankId(matched)) {
        const refreshed = await augmontGetUserBanks(uniqueId);
        syncPayload = refreshed;
        matched = findMatchingProviderBank(refreshed, account);
      }
    }

    const userBankId = providerBankId(matched);
    if (!userBankId) {
      throw new Error("Augmont did not return a bank reference for the verified account");
    }

    await pool.query(
      `UPDATE withdrawal_accounts
       SET augmont_user_bank_id=$1,
           augmont_bank_synced_at=NOW(),
           augmont_bank_payload=$2,
           augmont_bank_sync_error=NULL,
           updated_at=NOW()
       WHERE id=$3`,
      [userBankId, redactProviderPayload(syncPayload), account.id]
    );

    return {
      withdrawalAccountId: Number(account.id),
      userBankId,
      accountName,
      accountNumber: String(account.account_number),
      ifscCode: normalizeIfsc(account.ifsc),
      bankName: String(account.bank_name || ""),
      accountLast4: accountLast4(account.account_number),
    };
  } catch (error: any) {
    await pool
      .query(
        `UPDATE withdrawal_accounts
         SET augmont_bank_sync_error=$1, updated_at=NOW()
         WHERE id=$2`,
        [String(error?.message || error), account.id]
      )
      .catch(() => null);
    throw error;
  }
};
