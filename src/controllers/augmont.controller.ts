import { Response } from "express";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";
import {
  AugmontProviderError,
  augmontBuyGold,
  augmontCreateOrder,
  augmontCreateUser,
  augmontCreateUserBank,
  augmontDeleteUserAddress,
  augmontDeleteUserBank,
  augmontGetBuyInvoice,
  augmontGetBuyList,
  augmontGetBuyStatus,
  augmontGetCities,
  augmontGetHistoricalData,
  augmontGetOrderInfo,
  augmontGetOrderList,
  augmontGetPassbook,
  augmontGetProduct,
  augmontGetProducts,
  augmontGetRates,
  augmontGetRedeemInvoice,
  augmontGetSellInvoice,
  augmontGetSellList,
  augmontGetSellStatus,
  augmontGetSipRates,
  augmontGetStates,
  augmontGetTransferInfo,
  augmontGetTransferList,
  augmontGetUser,
  augmontGetUserAddresses,
  augmontGetUserBanks,
  augmontGetUserKyc,
  augmontGetWithdrawStatus,
  augmontLogin,
  augmontSaveUserAddress,
  augmontSellGold,
  augmontSubmitUserKyc,
  augmontTransfer,
  augmontUpdateUser,
  augmontUpdateUserBank,
  augmontUpdateWithdraw,
  extractDeep,
} from "../services/augmont.service";

const handle = async (res: Response, work: () => Promise<any>) => {
  try {
    const data = await work();
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Augmont request failed",
    });
  }
};

// Provider records are scoped to the authenticated user. Never trust a user ID
// supplied in a path, query string, or request body for self-service routes.
const uniqueIdFromRequest = (req: AuthRequest) => String(req.user?.uid || "");

const merchantTxnFromRequest = (req: AuthRequest) =>
  String(
    req.params.merchantTransactionId ||
      req.params.transactionId ||
      req.body.merchantTransactionId ||
      req.body.merchant_transaction_id ||
      ""
  );

const extractAddressId = (payload: any) => {
  const value = extractDeep(payload, [
    "userAddressId",
    "user_address_id",
    "addressId",
    "address_id",
    "id",
  ]);
  return value === undefined || value === null ? "" : String(value);
};

const resolveOrderAddressId = async (req: AuthRequest) => {
  const rawAddressId = String(
    req.body.userAddressId || req.body.user_address_id || req.body.addressId || ""
  );
  if (!rawAddressId) return rawAddressId;

  const localId = Number(rawAddressId);
  if (!Number.isInteger(localId) || localId <= 0) return rawAddressId;

  const result = await pool.query(
    `SELECT ua.*
     FROM user_addresses ua
     JOIN users u ON u.id = ua.user_id
     WHERE ua.id=$1 AND u.firebase_uid=$2`,
    [localId, req.user.uid]
  );

  const address = result.rows[0];
  if (!address) return rawAddressId;
  if (address.augmont_address_id) return String(address.augmont_address_id);

  const payload = {
    name: address.full_name,
    fullName: address.full_name,
    mobile: address.mobile,
    mobileNumber: address.mobile,
    phone: address.mobile,
    address: address.line1,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    pinCode: address.pincode,
    country: address.country || "India",
  };

  const providerPayload = await augmontSaveUserAddress(req.user.uid, payload);
  const augmontAddressId = extractAddressId(providerPayload);
  if (!augmontAddressId) {
    throw new Error("Augmont did not return a delivery address id");
  }

  await pool.query(
    `UPDATE user_addresses
     SET augmont_address_id=$1, provider_payload=$2, updated_at=NOW()
     WHERE id=$3`,
    [augmontAddressId, providerPayload, localId]
  );

  return augmontAddressId;
};

const kycValidityDays = Number(process.env.KYC_VALIDITY_DAYS || 365);

// Exact-match on an explicit status field only. A blind substring search over the
// whole stringified payload previously matched "success" inside messages like
// "KYC was not successful" or "verified" inside "account is unverified", flipping
// a rejection into an approval. Fail closed on anything not explicitly listed.
const augmontApprovedStatuses = new Set(["approved", "verified", "success", "completed", "complete", "full"]);
const augmontKycApproved = (payload: any) => {
  const status = String(
    extractDeep(payload, ["kycStatus", "kyc_status", "status", "verificationStatus"]) || ""
  ).trim().toLowerCase();
  return augmontApprovedStatuses.has(status);
};

const syncAugmontKyc = async (req: AuthRequest, payload: any) => {
  const userResult = await pool.query("SELECT id FROM users WHERE firebase_uid=$1 LIMIT 1", [
    req.user?.uid,
  ]);
  const userId = userResult.rows[0]?.id;
  if (!userId) return;

  const approved = augmontKycApproved(payload);
  const status = approved ? "full" : "pending";

  const referenceId =
    payload?.result?.data?.uniqueId || payload?.data?.uniqueId || req.user?.uid || null;

  const updated = await pool.query(
    `UPDATE kyc
     SET status=$2,
         aadhaar_status=$3,
         pan_status=$3,
         reference_id=COALESCE($4, reference_id),
         kyc_expires_at=CASE WHEN $5 THEN NOW() + ($6::text || ' days')::interval ELSE kyc_expires_at END,
         updated_at=NOW()
     WHERE id = (
       SELECT id
       FROM kyc
       WHERE user_id=$1 AND kyc_provider='augmont'
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1
     )`,
    [
      userId,
      status,
      approved ? "approved" : "pending",
      referenceId,
      approved,
      kycValidityDays,
    ]
  );

  if (updated.rowCount === 0) {
    await pool.query(
      `INSERT INTO kyc (
         user_id, status, aadhaar_status, pan_status, kyc_provider, reference_id,
         kyc_expires_at, updated_at
       )
       VALUES (
         $1, $2, $3, $3, 'augmont', $4,
         CASE WHEN $5 THEN NOW() + ($6::text || ' days')::interval ELSE NULL END,
         NOW()
       )`,
      [userId, status, approved ? "approved" : "pending", referenceId, approved, kycValidityDays]
    );
  }

  await pool.query(
    `UPDATE users
     SET kyc_status=$1,
         kyc_verified=$2,
         kyc_completed_at=CASE WHEN $2 THEN COALESCE(kyc_completed_at, NOW()) ELSE kyc_completed_at END
     WHERE id=$3`,
    [status, approved, userId]
  );
};

export const login = async (_req: AuthRequest, res: Response) =>
  handle(res, () => augmontLogin());

export const getRates = async (_req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetRates());

export const getHistoricalData = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetHistoricalData({ ...req.query }));

export const getStates = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetStates({ ...req.query }));

export const getCities = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetCities({ ...req.query }));

export const getProducts = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetProducts({ ...req.query }));

export const getProduct = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetProduct(String(req.params.sku)));

export const createUser = async (req: AuthRequest, res: Response) =>
  handle(res, () =>
    augmontCreateUser({
      ...req.body,
      uniqueId: uniqueIdFromRequest(req),
    })
  );

export const updateUser = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontUpdateUser(uniqueIdFromRequest(req), req.body));

export const getUser = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetUser(uniqueIdFromRequest(req)));

export const getUserKyc = async (req: AuthRequest, res: Response) =>
  handle(res, async () => {
    const data = await augmontGetUserKyc(uniqueIdFromRequest(req));
    await syncAugmontKyc(req, data);
    return data;
  });

export const submitUserKyc = async (req: AuthRequest, res: Response) =>
  handle(res, async () => {
    const data = await augmontSubmitUserKyc(uniqueIdFromRequest(req), req.body);
    await syncAugmontKyc(req, data);
    return data;
  });

export const createUserBank = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontCreateUserBank(uniqueIdFromRequest(req), req.body));

export const updateUserBank = async (req: AuthRequest, res: Response) =>
  handle(res, () =>
    augmontUpdateUserBank(uniqueIdFromRequest(req), String(req.params.userBankId), req.body)
  );

export const getUserBanks = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetUserBanks(uniqueIdFromRequest(req)));

export const deleteUserBank = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontDeleteUserBank(uniqueIdFromRequest(req), String(req.params.userBankId)));

export const saveUserAddress = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontSaveUserAddress(uniqueIdFromRequest(req), req.body));

export const getUserAddresses = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetUserAddresses(uniqueIdFromRequest(req)));

export const deleteUserAddress = async (req: AuthRequest, res: Response) =>
  handle(res, () =>
    augmontDeleteUserAddress(uniqueIdFromRequest(req), String(req.params.userAddressId))
  );

export const getPassbook = async (req: AuthRequest, res: Response) => {
  try {
    const data = await augmontGetPassbook(uniqueIdFromRequest(req));
    return res.json({ success: true, data });
  } catch (error) {
    const missingAccount = error instanceof AugmontProviderError &&
      [404, 422].includes(Number(error.status)) &&
      /user account does not exist|user (?:account )?not found/i.test(error.message);
    if (missingAccount) {
      return res.status(409).json({
        success: false,
        code: "AUGMONT_ACCOUNT_REQUIRED",
        action: "complete_profile",
        message: "Complete your profile and save an address to set up your gold account before buying.",
        providerBalanceVerified: false,
      });
    }
    return res.status(502).json({
      success: false,
      code: "AUGMONT_PASSBOOK_UNAVAILABLE",
      message: "Gold balance verification is temporarily unavailable. Please try again.",
      providerBalanceVerified: false,
    });
  }
};

export const buyGold = async (req: AuthRequest, res: Response) =>
  handle(res, () =>
    augmontBuyGold({
      ...req.body,
      userId: uniqueIdFromRequest(req),
      amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
      quantity: req.body.quantity !== undefined ? Number(req.body.quantity) : undefined,
      merchantTransactionId: req.body.merchantTransactionId || req.body.merchant_transaction_id,
    })
  );

export const sellGold = async (req: AuthRequest, res: Response) =>
  handle(res, () =>
    augmontSellGold({
      ...req.body,
      userId: uniqueIdFromRequest(req),
      grams: req.body.grams !== undefined ? Number(req.body.grams) : req.body.quantity,
      amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
      merchantTransactionId: req.body.merchantTransactionId || req.body.merchant_transaction_id,
    })
  );

export const getBuyStatus = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetBuyStatus(merchantTxnFromRequest(req), uniqueIdFromRequest(req)));

export const getBuyList = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetBuyList(uniqueIdFromRequest(req), { ...req.query }));

export const getSellStatus = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetSellStatus(merchantTxnFromRequest(req), uniqueIdFromRequest(req)));

export const getSellList = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetSellList(uniqueIdFromRequest(req), { ...req.query }));

export const createOrder = async (req: AuthRequest, res: Response) =>
  handle(res, async () => {
    const addressId = await resolveOrderAddressId(req);
    return augmontCreateOrder({
      ...req.body,
      uniqueId: uniqueIdFromRequest(req),
      userAddressId: addressId || req.body.userAddressId,
      user_address_id: addressId || req.body.user_address_id,
    });
  });

export const getOrderList = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetOrderList(uniqueIdFromRequest(req), { ...req.query }));

export const getOrderInfo = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetOrderInfo(merchantTxnFromRequest(req), uniqueIdFromRequest(req)));

export const transfer = async (req: AuthRequest, res: Response) =>
  handle(res, () =>
    augmontTransfer({
      ...req.body,
      "sender[uniqueId]": uniqueIdFromRequest(req),
      "receiver[uniqueId]":
        req.body["receiver[uniqueId]"] || req.body.receiverUniqueId || req.body.receiver_unique_id,
    })
  );

export const getTransferInfo = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetTransferInfo(merchantTxnFromRequest(req), uniqueIdFromRequest(req)));

export const getTransferList = async (req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetTransferList(uniqueIdFromRequest(req), { ...req.query }));

export const getWithdrawStatus = async (req: AuthRequest, res: Response) =>
  handle(res, () =>
    augmontGetWithdrawStatus(String(req.params.sellTxnId || req.params.merchantTransactionId), uniqueIdFromRequest(req))
  );

export const updateWithdraw = async (req: AuthRequest, res: Response) =>
  handle(res, () =>
    augmontUpdateWithdraw(String(req.params.sellTxnId), uniqueIdFromRequest(req), req.body)
  );

const ownedGoldTransaction = async (
  req: AuthRequest,
  transactionId: string,
  type: "buy" | "sell"
) => {
  const result = await pool.query(
    `SELECT gt.augmont_txn_id
     FROM gold_transactions gt
     JOIN users u ON u.id=gt.user_id
       WHERE u.firebase_uid=$1 AND gt.type=$2
         AND (gt.augmont_txn_id=$3 OR gt.merchant_txn_id=$3 OR gt.id::text=$3)
         AND LOWER(COALESCE(gt.status,'')) IN ('success','completed','complete','confirmed','approved')
         AND gt.gold_grams > 0
     LIMIT 1`,
    [req.user.uid, type, transactionId]
  );
  return result.rows[0]?.augmont_txn_id ? String(result.rows[0].augmont_txn_id) : "";
};

export const getBuyInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const providerId = await ownedGoldTransaction(req, String(req.params.transactionId), "buy");
    if (!providerId) return res.status(404).json({ message: "Buy transaction not found" });
    return handle(res, () => augmontGetBuyInvoice(providerId));
  } catch {
    return res.status(500).json({ success: false, message: "Unable to retrieve buy invoice" });
  }
};

export const getSellInvoice = async (req: AuthRequest, res: Response) => {
  const providerId = await ownedGoldTransaction(req, String(req.params.transactionId), "sell");
  if (!providerId) return res.status(404).json({ message: "Sell transaction not found" });
  return handle(res, () => augmontGetSellInvoice(providerId));
};

const ownedOrderTransaction = async (req: AuthRequest, transactionId: string) => {
  if (!transactionId) return false;
  const result = await pool.query(
    `SELECT 1
     FROM checkout_intents ci
     JOIN users u ON u.id = ci.user_id
     WHERE u.firebase_uid=$1
       AND ci.purpose='physical_product'
       AND ci.status='completed'
       AND ci.provider_payload::text ILIKE '%' || $2 || '%'
     LIMIT 1`,
    [req.user.uid, transactionId]
  );
  return result.rowCount! > 0;
};

export const getRedeemInvoice = async (req: AuthRequest, res: Response) => {
  const transactionId = String(req.params.transactionId);
  const owned = await ownedOrderTransaction(req, transactionId);
  if (!owned) return res.status(404).json({ message: "Order transaction not found" });
  return handle(res, () => augmontGetRedeemInvoice(transactionId));
};

export const getSipRates = async (_req: AuthRequest, res: Response) =>
  handle(res, () => augmontGetSipRates());
