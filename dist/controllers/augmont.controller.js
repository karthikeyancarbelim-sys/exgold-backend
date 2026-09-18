"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSipRates = exports.getRedeemInvoice = exports.getSellInvoice = exports.getBuyInvoice = exports.updateWithdraw = exports.getWithdrawStatus = exports.getTransferList = exports.getTransferInfo = exports.transfer = exports.getOrderInfo = exports.getOrderList = exports.createOrder = exports.getSellList = exports.getSellStatus = exports.getBuyList = exports.getBuyStatus = exports.sellGold = exports.buyGold = exports.getPassbook = exports.deleteUserAddress = exports.getUserAddresses = exports.saveUserAddress = exports.deleteUserBank = exports.getUserBanks = exports.updateUserBank = exports.createUserBank = exports.submitUserKyc = exports.getUserKyc = exports.getUser = exports.updateUser = exports.createUser = exports.getProduct = exports.getProducts = exports.getCities = exports.getStates = exports.getHistoricalData = exports.getRates = exports.login = void 0;
const db_1 = require("../config/db");
const augmont_service_1 = require("../services/augmont.service");
const handle = async (res, work) => {
    try {
        const data = await work();
        return res.json({ success: true, data });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Augmont request failed",
        });
    }
};
// Provider records are scoped to the authenticated user. Never trust a user ID
// supplied in a path, query string, or request body for self-service routes.
const uniqueIdFromRequest = (req) => String(req.user?.uid || "");
const merchantTxnFromRequest = (req) => String(req.params.merchantTransactionId ||
    req.params.transactionId ||
    req.body.merchantTransactionId ||
    req.body.merchant_transaction_id ||
    "");
const extractAddressId = (payload) => {
    const value = (0, augmont_service_1.extractDeep)(payload, [
        "userAddressId",
        "user_address_id",
        "addressId",
        "address_id",
        "id",
    ]);
    return value === undefined || value === null ? "" : String(value);
};
const resolveOrderAddressId = async (req) => {
    const rawAddressId = String(req.body.userAddressId || req.body.user_address_id || req.body.addressId || "");
    if (!rawAddressId)
        return rawAddressId;
    const localId = Number(rawAddressId);
    if (!Number.isInteger(localId) || localId <= 0)
        return rawAddressId;
    const result = await db_1.pool.query(`SELECT ua.*
     FROM user_addresses ua
     JOIN users u ON u.id = ua.user_id
     WHERE ua.id=$1 AND u.firebase_uid=$2`, [localId, req.user.uid]);
    const address = result.rows[0];
    if (!address)
        return rawAddressId;
    if (address.augmont_address_id)
        return String(address.augmont_address_id);
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
    const providerPayload = await (0, augmont_service_1.augmontSaveUserAddress)(req.user.uid, payload);
    const augmontAddressId = extractAddressId(providerPayload);
    if (!augmontAddressId) {
        throw new Error("Augmont did not return a delivery address id");
    }
    await db_1.pool.query(`UPDATE user_addresses
     SET augmont_address_id=$1, provider_payload=$2, updated_at=NOW()
     WHERE id=$3`, [augmontAddressId, providerPayload, localId]);
    return augmontAddressId;
};
const kycValidityDays = Number(process.env.KYC_VALIDITY_DAYS || 365);
// Exact-match on an explicit status field only. A blind substring search over the
// whole stringified payload previously matched "success" inside messages like
// "KYC was not successful" or "verified" inside "account is unverified", flipping
// a rejection into an approval. Fail closed on anything not explicitly listed.
const augmontApprovedStatuses = new Set(["approved", "verified", "success", "completed", "complete", "full"]);
const augmontKycApproved = (payload) => {
    const status = String((0, augmont_service_1.extractDeep)(payload, ["kycStatus", "kyc_status", "status", "verificationStatus"]) || "").trim().toLowerCase();
    return augmontApprovedStatuses.has(status);
};
const syncAugmontKyc = async (req, payload) => {
    const userResult = await db_1.pool.query("SELECT id FROM users WHERE firebase_uid=$1 LIMIT 1", [
        req.user?.uid,
    ]);
    const userId = userResult.rows[0]?.id;
    if (!userId)
        return;
    const approved = augmontKycApproved(payload);
    const status = approved ? "full" : "pending";
    const referenceId = payload?.result?.data?.uniqueId || payload?.data?.uniqueId || req.user?.uid || null;
    const updated = await db_1.pool.query(`UPDATE kyc
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
     )`, [
        userId,
        status,
        approved ? "approved" : "pending",
        referenceId,
        approved,
        kycValidityDays,
    ]);
    if (updated.rowCount === 0) {
        await db_1.pool.query(`INSERT INTO kyc (
         user_id, status, aadhaar_status, pan_status, kyc_provider, reference_id,
         kyc_expires_at, updated_at
       )
       VALUES (
         $1, $2, $3, $3, 'augmont', $4,
         CASE WHEN $5 THEN NOW() + ($6::text || ' days')::interval ELSE NULL END,
         NOW()
       )`, [userId, status, approved ? "approved" : "pending", referenceId, approved, kycValidityDays]);
    }
    await db_1.pool.query(`UPDATE users
     SET kyc_status=$1,
         kyc_verified=$2,
         kyc_completed_at=CASE WHEN $2 THEN COALESCE(kyc_completed_at, NOW()) ELSE kyc_completed_at END
     WHERE id=$3`, [status, approved, userId]);
};
const login = async (_req, res) => handle(res, () => (0, augmont_service_1.augmontLogin)());
exports.login = login;
const getRates = async (_req, res) => handle(res, () => (0, augmont_service_1.augmontGetRates)());
exports.getRates = getRates;
const getHistoricalData = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetHistoricalData)({ ...req.query }));
exports.getHistoricalData = getHistoricalData;
const getStates = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetStates)({ ...req.query }));
exports.getStates = getStates;
const getCities = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetCities)({ ...req.query }));
exports.getCities = getCities;
const getProducts = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetProducts)({ ...req.query }));
exports.getProducts = getProducts;
const getProduct = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetProduct)(String(req.params.sku)));
exports.getProduct = getProduct;
const createUser = async (req, res) => handle(res, () => (0, augmont_service_1.augmontCreateUser)({
    ...req.body,
    uniqueId: uniqueIdFromRequest(req),
}));
exports.createUser = createUser;
const updateUser = async (req, res) => handle(res, () => (0, augmont_service_1.augmontUpdateUser)(uniqueIdFromRequest(req), req.body));
exports.updateUser = updateUser;
const getUser = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetUser)(uniqueIdFromRequest(req)));
exports.getUser = getUser;
const getUserKyc = async (req, res) => handle(res, async () => {
    const data = await (0, augmont_service_1.augmontGetUserKyc)(uniqueIdFromRequest(req));
    await syncAugmontKyc(req, data);
    return data;
});
exports.getUserKyc = getUserKyc;
const submitUserKyc = async (req, res) => handle(res, async () => {
    const data = await (0, augmont_service_1.augmontSubmitUserKyc)(uniqueIdFromRequest(req), req.body);
    await syncAugmontKyc(req, data);
    return data;
});
exports.submitUserKyc = submitUserKyc;
const createUserBank = async (req, res) => handle(res, () => (0, augmont_service_1.augmontCreateUserBank)(uniqueIdFromRequest(req), req.body));
exports.createUserBank = createUserBank;
const updateUserBank = async (req, res) => handle(res, () => (0, augmont_service_1.augmontUpdateUserBank)(uniqueIdFromRequest(req), String(req.params.userBankId), req.body));
exports.updateUserBank = updateUserBank;
const getUserBanks = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetUserBanks)(uniqueIdFromRequest(req)));
exports.getUserBanks = getUserBanks;
const deleteUserBank = async (req, res) => handle(res, () => (0, augmont_service_1.augmontDeleteUserBank)(uniqueIdFromRequest(req), String(req.params.userBankId)));
exports.deleteUserBank = deleteUserBank;
const saveUserAddress = async (req, res) => handle(res, () => (0, augmont_service_1.augmontSaveUserAddress)(uniqueIdFromRequest(req), req.body));
exports.saveUserAddress = saveUserAddress;
const getUserAddresses = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetUserAddresses)(uniqueIdFromRequest(req)));
exports.getUserAddresses = getUserAddresses;
const deleteUserAddress = async (req, res) => handle(res, () => (0, augmont_service_1.augmontDeleteUserAddress)(uniqueIdFromRequest(req), String(req.params.userAddressId)));
exports.deleteUserAddress = deleteUserAddress;
const getPassbook = async (req, res) => {
    try {
        const data = await (0, augmont_service_1.augmontGetPassbook)(uniqueIdFromRequest(req));
        return res.json({ success: true, data });
    }
    catch (error) {
        const missingAccount = error instanceof augmont_service_1.AugmontProviderError &&
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
exports.getPassbook = getPassbook;
const buyGold = async (req, res) => handle(res, () => (0, augmont_service_1.augmontBuyGold)({
    ...req.body,
    userId: uniqueIdFromRequest(req),
    amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
    quantity: req.body.quantity !== undefined ? Number(req.body.quantity) : undefined,
    merchantTransactionId: req.body.merchantTransactionId || req.body.merchant_transaction_id,
}));
exports.buyGold = buyGold;
const sellGold = async (req, res) => handle(res, () => (0, augmont_service_1.augmontSellGold)({
    ...req.body,
    userId: uniqueIdFromRequest(req),
    grams: req.body.grams !== undefined ? Number(req.body.grams) : req.body.quantity,
    amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
    merchantTransactionId: req.body.merchantTransactionId || req.body.merchant_transaction_id,
}));
exports.sellGold = sellGold;
const getBuyStatus = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetBuyStatus)(merchantTxnFromRequest(req), uniqueIdFromRequest(req)));
exports.getBuyStatus = getBuyStatus;
const getBuyList = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetBuyList)(uniqueIdFromRequest(req), { ...req.query }));
exports.getBuyList = getBuyList;
const getSellStatus = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetSellStatus)(merchantTxnFromRequest(req), uniqueIdFromRequest(req)));
exports.getSellStatus = getSellStatus;
const getSellList = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetSellList)(uniqueIdFromRequest(req), { ...req.query }));
exports.getSellList = getSellList;
const createOrder = async (req, res) => handle(res, async () => {
    const addressId = await resolveOrderAddressId(req);
    return (0, augmont_service_1.augmontCreateOrder)({
        ...req.body,
        uniqueId: uniqueIdFromRequest(req),
        userAddressId: addressId || req.body.userAddressId,
        user_address_id: addressId || req.body.user_address_id,
    });
});
exports.createOrder = createOrder;
const getOrderList = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetOrderList)(uniqueIdFromRequest(req), { ...req.query }));
exports.getOrderList = getOrderList;
const getOrderInfo = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetOrderInfo)(merchantTxnFromRequest(req), uniqueIdFromRequest(req)));
exports.getOrderInfo = getOrderInfo;
const transfer = async (req, res) => handle(res, () => (0, augmont_service_1.augmontTransfer)({
    ...req.body,
    "sender[uniqueId]": uniqueIdFromRequest(req),
    "receiver[uniqueId]": req.body["receiver[uniqueId]"] || req.body.receiverUniqueId || req.body.receiver_unique_id,
}));
exports.transfer = transfer;
const getTransferInfo = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetTransferInfo)(merchantTxnFromRequest(req), uniqueIdFromRequest(req)));
exports.getTransferInfo = getTransferInfo;
const getTransferList = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetTransferList)(uniqueIdFromRequest(req), { ...req.query }));
exports.getTransferList = getTransferList;
const getWithdrawStatus = async (req, res) => handle(res, () => (0, augmont_service_1.augmontGetWithdrawStatus)(String(req.params.sellTxnId || req.params.merchantTransactionId), uniqueIdFromRequest(req)));
exports.getWithdrawStatus = getWithdrawStatus;
const updateWithdraw = async (req, res) => handle(res, () => (0, augmont_service_1.augmontUpdateWithdraw)(String(req.params.sellTxnId), uniqueIdFromRequest(req), req.body));
exports.updateWithdraw = updateWithdraw;
const ownedGoldTransaction = async (req, transactionId, type) => {
    const result = await db_1.pool.query(`SELECT gt.augmont_txn_id
     FROM gold_transactions gt
     JOIN users u ON u.id=gt.user_id
       WHERE u.firebase_uid=$1 AND gt.type=$2
         AND (gt.augmont_txn_id=$3 OR gt.merchant_txn_id=$3 OR gt.id::text=$3)
         AND LOWER(COALESCE(gt.status,'')) IN ('success','completed','complete','confirmed','approved')
         AND gt.gold_grams > 0
     LIMIT 1`, [req.user.uid, type, transactionId]);
    return result.rows[0]?.augmont_txn_id ? String(result.rows[0].augmont_txn_id) : "";
};
const getBuyInvoice = async (req, res) => {
    try {
        const providerId = await ownedGoldTransaction(req, String(req.params.transactionId), "buy");
        if (!providerId)
            return res.status(404).json({ message: "Buy transaction not found" });
        return handle(res, () => (0, augmont_service_1.augmontGetBuyInvoice)(providerId));
    }
    catch {
        return res.status(500).json({ success: false, message: "Unable to retrieve buy invoice" });
    }
};
exports.getBuyInvoice = getBuyInvoice;
const getSellInvoice = async (req, res) => {
    const providerId = await ownedGoldTransaction(req, String(req.params.transactionId), "sell");
    if (!providerId)
        return res.status(404).json({ message: "Sell transaction not found" });
    return handle(res, () => (0, augmont_service_1.augmontGetSellInvoice)(providerId));
};
exports.getSellInvoice = getSellInvoice;
const ownedOrderTransaction = async (req, transactionId) => {
    if (!transactionId)
        return false;
    const result = await db_1.pool.query(`SELECT 1
     FROM checkout_intents ci
     JOIN users u ON u.id = ci.user_id
     WHERE u.firebase_uid=$1
       AND ci.purpose='physical_product'
       AND ci.status='completed'
       AND ci.provider_payload::text ILIKE '%' || $2 || '%'
     LIMIT 1`, [req.user.uid, transactionId]);
    return result.rowCount > 0;
};
const getRedeemInvoice = async (req, res) => {
    const transactionId = String(req.params.transactionId);
    const owned = await ownedOrderTransaction(req, transactionId);
    if (!owned)
        return res.status(404).json({ message: "Order transaction not found" });
    return handle(res, () => (0, augmont_service_1.augmontGetRedeemInvoice)(transactionId));
};
exports.getRedeemInvoice = getRedeemInvoice;
const getSipRates = async (_req, res) => handle(res, () => (0, augmont_service_1.augmontGetSipRates)());
exports.getSipRates = getSipRates;
