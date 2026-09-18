"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySubscription = exports.createSubscription = exports.verifyPayment = exports.createOrder = exports.verifyCheckoutPayment = exports.createPhysicalProductCheckout = exports.createDigitalGoldCheckout = void 0;
const crypto_1 = __importDefault(require("crypto"));
const razorpay_1 = require("../config/razorpay");
const db_1 = require("../config/db");
const augmont_service_1 = require("../services/augmont.service");
const investment_kyc_service_1 = require("../services/investment-kyc.service");
const digital_gold_settlement_service_1 = require("../services/digital-gold-settlement.service");
const provider_environment_1 = require("../utils/provider-environment");
const augmont_merchant_policy_1 = require("../utils/augmont-merchant-policy");
const financialYearBuyTotal = async (userId) => {
    const result = await db_1.pool.query(`SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM (
     SELECT amount FROM gold_transactions
     WHERE user_id=$1
       AND type='buy'
       AND LOWER(COALESCE(status,'')) IN ('success','completed')
       AND COALESCE(settled_at, created_at) >= $2
     UNION ALL
     SELECT ci.amount FROM checkout_intents ci
     WHERE ci.user_id=$1 AND ci.purpose='digital_gold'
       AND ci.razorpay_payment_id IS NOT NULL
       AND ci.status IN ('processing','provider_pending')
       AND NOT EXISTS (
         SELECT 1 FROM gold_transactions gt
         WHERE gt.user_id=ci.user_id
           AND gt.merchant_txn_id=ci.metadata->>'merchantTransactionId'
           AND LOWER(COALESCE(gt.status,'')) IN ('success','completed')
       )
     ) purchases`, [userId, (0, augmont_merchant_policy_1.indiaFinancialYearStart)()]);
    return (0, augmont_merchant_policy_1.roundMoney)(Number(result.rows[0]?.total || 0));
};
const kycBlockStatus = (eligibility) => {
    if (eligibility.code === "user_not_found")
        return 404;
    if (eligibility.code === "kyc_required" || eligibility.code === "kyc_expired")
        return 403;
    return 409;
};
const kycBlockPayload = (eligibility) => ({
    success: false,
    code: eligibility.code,
    message: eligibility.message,
    action: "complete_kyc",
    kycStatus: eligibility.localStatus,
    investmentKycStatus: eligibility.approved ? "approved" : eligibility.code,
    providerKycStatus: eligibility.providerStatus,
});
const paymentSignatureIsValid = (orderId, paymentId, signature) => crypto_1.default
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex") === signature;
const productPayable = (payload) => Number((0, augmont_service_1.extractDeep)(payload, ["sellingPrice", "productPrice", "price", "totalPrice", "mrp"]) || 0);
const getCurrentUser = async (uid) => {
    const result = await db_1.pool.query("SELECT id FROM users WHERE firebase_uid=$1 LIMIT 1", [uid]);
    return result.rows[0];
};
const createCheckoutIntent = async (req, purpose, amount, metadata) => {
    const user = await getCurrentUser(req.user.uid);
    if (!user)
        throw new Error("User not found");
    const intentId = crypto_1.default.randomUUID();
    const order = await razorpay_1.razorpay.orders.create({
        amount: Math.round(amount * 100),
        currency: "INR",
        receipt: `exg_${purpose}_${Date.now()}`.slice(0, 40),
        notes: {
            firebase_uid: req.user.uid,
            checkout_intent_id: intentId,
            purpose,
        },
    });
    await db_1.pool.query(`INSERT INTO checkout_intents
       (id, user_id, purpose, amount, status, razorpay_order_id, metadata)
     VALUES ($1,$2,$3,$4,'created',$5,$6)`, [intentId, user.id, purpose, amount, order.id, metadata]);
    return {
        checkoutId: intentId,
        orderId: order.id,
        amount: Number(order.amount) / 100,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
    };
};
const createDigitalGoldCheckout = async (req, res) => {
    try {
        const providerSafety = (0, provider_environment_1.getAugmontMoneySafety)();
        if (!providerSafety.safe) {
            return res.status(503).json({
                success: false,
                code: providerSafety.code,
                message: providerSafety.message,
            });
        }
        const amount = Number(req.body.amount);
        const amountError = (0, augmont_merchant_policy_1.validateBuyAmount)(amount);
        if (amountError)
            return res.status(400).json({ message: amountError });
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: "Invalid digital-gold amount" });
        }
        if (amount < augmont_merchant_policy_1.augmontMerchantPolicy.minimumBuyAmount) {
            return res.status(400).json({
                message: `Minimum digital gold purchase is Rs.${augmont_merchant_policy_1.augmontMerchantPolicy.minimumBuyAmount.toFixed(0)}`,
            });
        }
        if (amount > augmont_merchant_policy_1.augmontMerchantPolicy.maximumBuyAmount) {
            return res.status(400).json({
                message: `Maximum digital gold purchase is Rs.${augmont_merchant_policy_1.augmontMerchantPolicy.maximumBuyAmount.toFixed(0)}`,
            });
        }
        const user = await getCurrentUser(req.user.uid);
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const financialYearTotal = await financialYearBuyTotal(user.id);
        const requiresKyc = financialYearTotal + amount > augmont_merchant_policy_1.augmontMerchantPolicy.kycFinancialYearThreshold;
        let eligibility = null;
        if (requiresKyc) {
            eligibility = await (0, investment_kyc_service_1.getInvestmentKycEligibility)(req.user.uid, {
                refreshProvider: true,
            });
            if (!eligibility.approved) {
                return res.status(kycBlockStatus(eligibility)).json(kycBlockPayload(eligibility));
            }
        }
        await (0, investment_kyc_service_1.ensureAugmontInvestmentUser)(req.user.uid);
        if (requiresKyc) {
            eligibility = await (0, investment_kyc_service_1.getInvestmentKycEligibility)(req.user.uid, {
                refreshProvider: true,
            });
        }
        if (requiresKyc && !eligibility?.providerApproved) {
            return res.status(409).json({
                success: false,
                code: "provider_kyc_pending",
                message: "Digital gold will be available after provider KYC confirmation.",
                action: "wait_for_kyc",
                kycStatus: eligibility.localStatus,
                investmentKycStatus: "approved",
                providerKycStatus: eligibility.providerStatus,
            });
        }
        const checkout = await createCheckoutIntent(req, "digital_gold", amount, {
            merchantTransactionId: `EXGBUY_${crypto_1.default.randomBytes(10).toString("hex")}`,
            metalType: "gold",
            kycRequired: requiresKyc,
            kycApproved: eligibility?.approved === true,
            kycExpiresAt: eligibility?.expiresAt || null,
            providerKycStatus: eligibility?.providerStatus || "not_required",
            financialYearBuyTotal: financialYearTotal,
        });
        return res.status(201).json({ success: true, checkout });
    }
    catch (error) {
        return res.status(500).json({ message: error.message || "Unable to start payment" });
    }
};
exports.createDigitalGoldCheckout = createDigitalGoldCheckout;
const createPhysicalProductCheckout = async (req, res) => {
    try {
        const providerSafety = (0, provider_environment_1.getAugmontMoneySafety)();
        if (!providerSafety.safe) {
            return res.status(503).json({
                success: false,
                code: providerSafety.code,
                message: "Product checkout is temporarily paused while the live fulfilment provider is configured. No payment was created.",
            });
        }
        const addressId = String(req.body.addressId || req.body.userAddressId || "").trim();
        const items = Array.isArray(req.body.items) ? req.body.items : [];
        if (!addressId || items.length === 0) {
            return res.status(400).json({ message: "Choose a delivery address and add at least one product" });
        }
        const user = await getCurrentUser(req.user.uid);
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const address = await db_1.pool.query(`SELECT augmont_address_id
       FROM user_addresses
       WHERE user_id=$1 AND (id::text=$2 OR augmont_address_id=$2)
       LIMIT 1`, [user.id, addressId]);
        const providerAddressId = address.rows[0]?.augmont_address_id;
        if (!providerAddressId) {
            return res.status(409).json({
                message: "This delivery address is not ready for checkout. Save it again and retry.",
            });
        }
        const verifiedItems = [];
        for (const rawItem of items) {
            const sku = String(rawItem?.sku || "").trim();
            const quantity = Number(rawItem?.quantity);
            if (!sku || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
                return res.status(400).json({ message: "Each cart item needs a valid SKU and quantity" });
            }
            const product = await (0, augmont_service_1.augmontGetProduct)(sku);
            const unitAmount = productPayable(product);
            if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
                return res.status(409).json({ message: `Live payable price is unavailable for ${sku}` });
            }
            verifiedItems.push({ sku, quantity, unitAmount });
        }
        const amount = verifiedItems.reduce((total, item) => total + item.unitAmount * item.quantity, 0);
        const checkout = await createCheckoutIntent(req, "physical_product", amount, {
            addressId: providerAddressId,
            items: verifiedItems,
        });
        return res.status(201).json({ success: true, checkout });
    }
    catch (error) {
        return res.status(500).json({ message: error.message || "Unable to start product payment" });
    }
};
exports.createPhysicalProductCheckout = createPhysicalProductCheckout;
const verifyCheckoutPayment = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        const checkoutId = String(req.body.checkoutId || "");
        const paymentId = String(req.body.paymentId || "");
        const orderId = String(req.body.orderId || "");
        const signature = String(req.body.signature || "");
        if (!checkoutId || !paymentId || !orderId || !signature) {
            return res.status(400).json({ message: "Incomplete payment confirmation" });
        }
        if (!paymentSignatureIsValid(orderId, paymentId, signature)) {
            return res.status(400).json({ message: "Invalid payment signature" });
        }
        const preliminary = await db_1.pool.query(`SELECT ci.*, u.firebase_uid
       FROM checkout_intents ci
       JOIN users u ON u.id=ci.user_id
       WHERE ci.id=$1 AND u.firebase_uid=$2
       LIMIT 1`, [checkoutId, req.user.uid]);
        const preliminaryIntent = preliminary.rows[0];
        if (!preliminaryIntent || preliminaryIntent.razorpay_order_id !== orderId) {
            return res.status(404).json({ message: "Payment checkout not found" });
        }
        if (preliminaryIntent.purpose === "digital_gold") {
            try {
                const settlement = await (0, digital_gold_settlement_service_1.settleDigitalGoldCheckout)({
                    checkoutId,
                    paymentId,
                    orderId,
                    expectedFirebaseUid: req.user.uid,
                });
                return res.status(settlement.status === "processing" ? 202 : 200).json(settlement);
            }
            catch {
                return res.status(202).json({
                    success: false,
                    status: "provider_pending",
                    paymentReceived: true,
                    checkoutId,
                    message: "Payment is confirmed and protected. Gold allocation is awaiting provider confirmation.",
                });
            }
        }
        const providerPayment = (await razorpay_1.razorpay.payments.fetch(paymentId));
        if (providerPayment.order_id !== orderId || providerPayment.status !== "captured") {
            return res.status(409).json({ message: "Payment capture is still pending" });
        }
        const providerSafety = (0, provider_environment_1.getAugmontMoneySafety)();
        if (!providerSafety.safe) {
            await db_1.pool.query(`UPDATE checkout_intents
         SET status='provider_pending', razorpay_payment_id=$1,
             error_message=$2, updated_at=NOW()
         WHERE id=$3 AND status <> 'completed'`, [paymentId, providerSafety.message, checkoutId]);
            return res.status(202).json({
                success: false,
                status: "provider_pending",
                paymentReceived: true,
                checkoutId,
                message: "Payment is confirmed and protected. Fulfilment is paused until the live provider is configured.",
            });
        }
        await client.query("BEGIN");
        const result = await client.query(`SELECT ci.*, u.firebase_uid
       FROM checkout_intents ci
       JOIN users u ON u.id=ci.user_id
       WHERE ci.id=$1 AND ci.user_id=(SELECT id FROM users WHERE firebase_uid=$2)
       FOR UPDATE`, [checkoutId, req.user.uid]);
        const intent = result.rows[0];
        if (!intent || intent.razorpay_order_id !== orderId) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Payment checkout not found" });
        }
        if (intent.status === "completed") {
            await client.query("COMMIT");
            return res.json({ success: true, alreadyProcessed: true, status: "completed" });
        }
        if (intent.status === "processing") {
            await client.query("COMMIT");
            return res.status(409).json({ message: "Payment is already being processed" });
        }
        await client.query(`UPDATE checkout_intents
       SET status='processing', razorpay_payment_id=$1, updated_at=NOW()
       WHERE id=$2`, [paymentId, checkoutId]);
        await client.query("COMMIT");
        const orders = [];
        for (let index = 0; index < intent.metadata.items.length; index += 1) {
            const item = intent.metadata.items[index];
            orders.push(await (0, augmont_service_1.augmontCreateOrder)({
                uniqueId: req.user.uid,
                sku: item.sku,
                quantity: item.quantity,
                userAddressId: intent.metadata.addressId,
                user_address_id: intent.metadata.addressId,
                merchantTransactionId: `EXGORD_${checkoutId.replace(/-/g, "").slice(0, 18)}_${index + 1}`,
            }));
        }
        await client.query("BEGIN");
        await client.query(`UPDATE checkout_intents
       SET status='completed', provider_payload=$1, error_message=NULL, updated_at=NOW()
       WHERE id=$2`, [orders, checkoutId]);
        await client.query("COMMIT");
        return res.json({ success: true, status: "completed", checkoutId, orders });
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => null);
        const checkoutId = String(req.body.checkoutId || "");
        if (checkoutId) {
            await db_1.pool.query("UPDATE checkout_intents SET status='provider_pending', error_message=$1, updated_at=NOW() WHERE id=$2", [error.message || "Provider processing failed", checkoutId]).catch(() => null);
        }
        return res.status(502).json({
            message: "Payment was received. Your order is awaiting provider confirmation.",
        });
    }
    finally {
        client.release();
    }
};
exports.verifyCheckoutPayment = verifyCheckoutPayment;
/* ===============================
   CREATE ORDER (WALLET TOPUP)
   =============================== */
const createOrder = async (req, res) => {
    try {
        const uid = req.user.uid;
        const { amount } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Invalid amount" });
        }
        const order = await razorpay_1.razorpay.orders.create({
            amount: Math.round(amount * 100), // convert to paise
            currency: "INR",
            receipt: `wallet_${Date.now()}`,
            notes: {
                firebase_uid: uid,
            },
        });
        return res.json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            keyId: process.env.RAZORPAY_KEY_ID,
        });
    }
    catch (error) {
        console.error("CREATE ORDER ERROR:", error);
        return res.status(500).json({ message: "Failed to create order" });
    }
};
exports.createOrder = createOrder;
/* ===============================
   VERIFY PAYMENT (WALLET TOPUP)
   =============================== */
const verifyPayment = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        const uid = req.user.uid;
        const { paymentId, orderId, signature } = req.body;
        if (!paymentId || !orderId || !signature) {
            return res.status(400).json({ message: "Invalid data" });
        }
        /* 🔐 VERIFY SIGNATURE */
        const generatedSignature = crypto_1.default
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(orderId + "|" + paymentId)
            .digest("hex");
        if (generatedSignature !== signature) {
            return res.status(400).json({ message: "Invalid signature" });
        }
        const providerOrder = (await razorpay_1.razorpay.orders.fetch(orderId));
        const providerPayment = (await razorpay_1.razorpay.payments.fetch(paymentId));
        if (providerOrder.notes?.firebase_uid !== uid ||
            providerOrder.notes?.purpose ||
            providerPayment.order_id !== orderId ||
            providerPayment.status !== "captured") {
            return res.status(400).json({ message: "Invalid wallet payment" });
        }
        const amount = Number(providerOrder.amount) / 100;
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: "Invalid payment amount" });
        }
        await client.query("BEGIN");
        /* 🔎 GET USER */
        const existingPayment = await client.query("SELECT id FROM wallet_transactions WHERE reference_id=$1", [paymentId]);
        if (existingPayment.rows.length > 0) {
            await client.query("COMMIT");
            return res.json({
                success: true,
                alreadyProcessed: true,
            });
        }
        const userRes = await client.query("SELECT id FROM users WHERE firebase_uid=$1", [uid]);
        if (userRes.rows.length === 0) {
            throw new Error("User not found");
        }
        const userId = userRes.rows[0].id;
        /* 💰 GET WALLET */
        const walletRes = await client.query("SELECT balance FROM wallets WHERE user_id=$1", [userId]);
        if (walletRes.rows.length === 0) {
            throw new Error("Wallet not found");
        }
        const currentBalance = Number(walletRes.rows[0].balance);
        const newBalance = currentBalance + Number(amount);
        /* 💰 UPDATE WALLET */
        await client.query("UPDATE wallets SET balance=$1 WHERE user_id=$2", [newBalance, userId]);
        /* 🧾 INSERT TRANSACTION */
        await client.query(`INSERT INTO wallet_transactions
       (user_id, type, amount, method, reference_id, status)
       VALUES ($1, 'credit', $2, 'razorpay', $3, 'success')`, [userId, amount, paymentId]);
        await client.query("COMMIT");
        return res.json({
            success: true,
            balance: newBalance,
        });
    }
    catch (error) {
        await client.query("ROLLBACK");
        console.error("VERIFY PAYMENT ERROR:", error);
        return res.status(500).json({
            message: error.message,
        });
    }
    finally {
        client.release();
    }
};
exports.verifyPayment = verifyPayment;
/* ===============================
   EXISTING SUBSCRIPTION (KEEP)
   =============================== */
const createSubscription = async (req, res) => {
    const { plan_id } = req.body;
    try {
        const subscription = await razorpay_1.razorpay.subscriptions.create({
            plan_id,
            total_count: 12,
            customer_notify: 1,
        });
        res.json({
            success: true,
            subscription,
        });
    }
    catch (error) {
        res.status(500).json({
            error: "Failed to create subscription",
        });
    }
};
exports.createSubscription = createSubscription;
const verifySubscription = async (req, res) => {
    const uid = req.user.uid;
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, plan_type, } = req.body;
    const client = await db_1.pool.connect();
    try {
        const secret = process.env.RAZORPAY_KEY_SECRET;
        const generatedSignature = crypto_1.default
            .createHmac("sha256", secret)
            .update(razorpay_payment_id + "|" + razorpay_subscription_id)
            .digest("hex");
        if (generatedSignature !== razorpay_signature) {
            throw new Error("Invalid signature");
        }
        await client.query("BEGIN");
        const existingSubscriptionPayment = await client.query("SELECT id FROM transactions WHERE reference_id=$1", [razorpay_payment_id]);
        if (existingSubscriptionPayment.rows.length > 0) {
            await client.query("COMMIT");
            return res.json({
                success: true,
                alreadyProcessed: true,
            });
        }
        const userResult = await client.query("SELECT id FROM users WHERE firebase_uid=$1", [uid]);
        const userId = userResult.rows[0].id;
        let durationDays = 30;
        if (plan_type === "SIX_MONTHS")
            durationDays = 180;
        if (plan_type === "YEARLY")
            durationDays = 365;
        await client.query(`UPDATE users
       SET subscription_active=true,
           subscription_start=NOW(),
           subscription_end=NOW() + ($1 || ' days')::interval,
           subscription_plan=$3,
           ads_limit=999
       WHERE id=$2`, [durationDays, userId, plan_type || "MONTHLY"]);
        await client.query(`INSERT INTO transactions
       (user_id, type, amount, status, reference_id)
       VALUES ($1,'SUBSCRIPTION',0,'SUCCESS',$2)`, [userId, razorpay_payment_id]);
        await client.query("COMMIT");
        res.json({
            success: true,
            message: "Subscription activated",
        });
    }
    catch (error) {
        await client.query("ROLLBACK");
        res.status(500).json({
            error: error.message,
        });
    }
    finally {
        client.release();
    }
};
exports.verifySubscription = verifySubscription;
