"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateGoldMargin = exports.updateAdminGoldRates = exports.getAdminGoldRates = exports.forceKycReverify = exports.updateKycStatus = exports.getAllKyc = exports.approveAd = exports.deleteAdminAd = exports.updateAdminAd = exports.createAdminAd = exports.getAllAds = exports.reconcileDigitalGoldSalePayout = exports.reconcileDigitalGoldCheckout = exports.confirmAugmontMerchantSettlement = exports.getAllGoldTransactions = exports.deleteAdminUser = exports.updateAdminUser = exports.createAdminUser = exports.getAllTransactions = exports.adjustWallet = exports.blockUser = exports.getAllUsers = exports.getAuditLogs = exports.getMonitoringOverview = exports.getDashboardStats = exports.deleteAdminAccount = exports.updateAdminAccount = exports.createAdminAccount = exports.getAdminAccounts = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../config/db");
const firebase_1 = __importDefault(require("../config/firebase"));
const kyc_evidence_1 = require("../utils/kyc-evidence");
const digital_gold_settlement_service_1 = require("../services/digital-gold-settlement.service");
const digital_gold_sale_settlement_service_1 = require("../services/digital-gold-sale-settlement.service");
const augmont_merchant_settlement_service_1 = require("../services/augmont-merchant-settlement.service");
const kycValidityDays = Number(process.env.KYC_VALIDITY_DAYS || 365);
const parseKarat = (karat) => {
    const value = Number(String(karat).replace(/k/i, ""));
    return [18, 22, 24].includes(value) ? value : null;
};
const kycOverallStatus = (kyc) => {
    const aadhaar = String(kyc.aadhaar_status || "none").toLowerCase();
    const pan = String(kyc.pan_status || "none").toLowerCase();
    if (String(kyc.status || "").toLowerCase() === "expired")
        return "expired";
    if (aadhaar === "rejected" || pan === "rejected")
        return "rejected";
    if (aadhaar === "approved" && pan === "approved")
        return "full";
    if (aadhaar === "approved" || pan === "approved" || aadhaar === "pending" || pan === "pending") {
        return "pending";
    }
    return "none";
};
const maskPan = (pan) => {
    const value = String(pan || "").trim().toUpperCase();
    if (value.length < 10)
        return value || null;
    return `${value.slice(0, 2)}XXXX${value.slice(-4)}`;
};
const createAdminAuditLog = async (action, entityType, entityId, metadata = {}) => {
    await db_1.pool.query(`INSERT INTO admin_audit_logs (action, entity_type, entity_id, actor, metadata)
     VALUES ($1,$2,$3,$4,$5)`, [
        action,
        entityType,
        entityId,
        metadata.actor || "admin",
        metadata,
    ]).catch(() => null);
};
const safeScalar = async (sql, fallback = 0) => {
    try {
        const result = await db_1.pool.query(sql);
        const row = result.rows[0] || {};
        const value = Object.values(row)[0];
        return Number(value || fallback);
    }
    catch (error) {
        console.warn("DASHBOARD OPTIONAL QUERY SKIPPED:", error?.message || error);
        return fallback;
    }
};
const userWhereClause = (id, offset) => {
    const numericId = Number(id);
    if (Number.isInteger(numericId)) {
        return { clause: `id=$${offset}`, value: numericId };
    }
    return { clause: `firebase_uid=$${offset}`, value: id };
};
const postingBypassRoles = ["internal", "team", "staff", "admin", "superadmin"];
const elevatedUserRoles = ["admin", "superadmin"];
const actorIsSuperAdmin = (req) => String(req.user?.role || "").toLowerCase() === "superadmin";
const rejectElevatedRoleChange = (req, res, role) => {
    const nextRole = String(role || "").toLowerCase();
    if (elevatedUserRoles.includes(nextRole) && !actorIsSuperAdmin(req)) {
        res.status(403).json({ message: "Only super admins can assign admin roles" });
        return true;
    }
    return false;
};
const requireSuperAdmin = (req, res) => {
    if (!actorIsSuperAdmin(req)) {
        res.status(403).json({ message: "Super admin access required" });
        return false;
    }
    return true;
};
const getAdminAccounts = async (req, res) => {
    if (!requireSuperAdmin(req, res))
        return;
    try {
        const result = await db_1.pool.query(`
      SELECT id, username, email, role, status, last_login AS "lastLogin", created_at AS "createdAt"
      FROM admins
      ORDER BY created_at DESC, id DESC
    `);
        return res.json(result.rows);
    }
    catch (error) {
        console.error("GET ADMIN ACCOUNTS ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch admin accounts" });
    }
};
exports.getAdminAccounts = getAdminAccounts;
const createAdminAccount = async (req, res) => {
    if (!requireSuperAdmin(req, res))
        return;
    try {
        const username = String(req.body.username || "").trim().toLowerCase();
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");
        const role = String(req.body.role || "admin").toLowerCase();
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }
        if (!["admin", "superadmin"].includes(role)) {
            return res.status(400).json({ message: "Invalid admin role" });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: "Password must be at least 8 characters" });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        const result = await db_1.pool.query(`INSERT INTO admins (username, email, password, role, status)
       VALUES ($1,$2,$3,$4,'active')
       RETURNING id, username, email, role, status, created_at AS "createdAt"`, [username || null, email, passwordHash, role]);
        await createAdminAuditLog("admin_account_create", "admin", String(result.rows[0].id), {
            actor: req.user?.email || "admin",
            email,
            role,
        });
        return res.status(201).json({ success: true, admin: result.rows[0] });
    }
    catch (error) {
        console.error("CREATE ADMIN ACCOUNT ERROR:", error);
        if (String(error?.code) === "23505") {
            return res.status(409).json({ message: "Admin email or username already exists" });
        }
        return res.status(500).json({ message: "Failed to create admin account" });
    }
};
exports.createAdminAccount = createAdminAccount;
const updateAdminAccount = async (req, res) => {
    if (!requireSuperAdmin(req, res))
        return;
    try {
        const allowedFields = {
            username: "username",
            email: "email",
            role: "role",
            status: "status",
        };
        const updates = [];
        const values = [];
        if (req.body.role !== undefined && !["admin", "superadmin"].includes(String(req.body.role).toLowerCase())) {
            return res.status(400).json({ message: "Invalid admin role" });
        }
        if (req.body.status !== undefined && !["active", "blocked"].includes(String(req.body.status).toLowerCase())) {
            return res.status(400).json({ message: "Invalid admin status" });
        }
        Object.entries(allowedFields).forEach(([bodyKey, column]) => {
            if (req.body[bodyKey] === undefined)
                return;
            values.push(String(req.body[bodyKey] || "").trim().toLowerCase());
            updates.push(`${column}=$${values.length}`);
        });
        if (req.body.password !== undefined && String(req.body.password).length > 0) {
            const password = String(req.body.password);
            if (password.length < 8) {
                return res.status(400).json({ message: "Password must be at least 8 characters" });
            }
            values.push(await bcryptjs_1.default.hash(password, 12));
            updates.push(`password=$${values.length}`);
        }
        if (updates.length === 0) {
            return res.status(400).json({ message: "No editable fields provided" });
        }
        values.push(req.params.id);
        const result = await db_1.pool.query(`UPDATE admins
       SET ${updates.join(", ")}
       WHERE id=$${values.length}
       RETURNING id, username, email, role, status, last_login AS "lastLogin", created_at AS "createdAt"`, values);
        if (!result.rows.length) {
            return res.status(404).json({ message: "Admin account not found" });
        }
        await createAdminAuditLog("admin_account_update", "admin", String(req.params.id), {
            actor: req.user?.email || "admin",
            fields: Object.keys(req.body).filter((key) => key !== "password"),
        });
        return res.json({ success: true, admin: result.rows[0] });
    }
    catch (error) {
        console.error("UPDATE ADMIN ACCOUNT ERROR:", error);
        if (String(error?.code) === "23505") {
            return res.status(409).json({ message: "Admin email or username already exists" });
        }
        return res.status(500).json({ message: "Failed to update admin account" });
    }
};
exports.updateAdminAccount = updateAdminAccount;
const deleteAdminAccount = async (req, res) => {
    if (!requireSuperAdmin(req, res))
        return;
    try {
        const actorId = Number(req.user?.id);
        const targetId = Number(req.params.id);
        if (actorId === targetId) {
            return res.status(400).json({ message: "You cannot delete your own admin login" });
        }
        const result = await db_1.pool.query("UPDATE admins SET status='blocked' WHERE id=$1 RETURNING id", [targetId]);
        if (!result.rows.length) {
            return res.status(404).json({ message: "Admin account not found" });
        }
        await createAdminAuditLog("admin_account_block", "admin", String(targetId), {
            actor: req.user?.email || "admin",
        });
        return res.json({ success: true });
    }
    catch (error) {
        console.error("DELETE ADMIN ACCOUNT ERROR:", error);
        return res.status(500).json({ message: "Failed to block admin account" });
    }
};
exports.deleteAdminAccount = deleteAdminAccount;
/* ===============================
   DASHBOARD STATS (ADMIN)
   =============================== */
const getDashboardStats = async (_req, res) => {
    try {
        const [usersSnap, adsSnap] = await Promise.all([
            firebase_1.default.firestore().collection("users").get().catch(() => null),
            firebase_1.default.firestore().collection("ads").get().catch(() => null),
        ]);
        const [sqlUsers, revenue, pendingKyc, pendingAds, activeSubscriptions, investmentTransactions, goldBought, goldSold,] = await Promise.all([
            safeScalar("SELECT COUNT(*)::int AS value FROM users"),
            safeScalar("SELECT COALESCE(SUM(amount), 0)::numeric AS value FROM wallet_transactions WHERE status='success' AND type='credit'"),
            safeScalar("SELECT COUNT(*)::int AS value FROM kyc WHERE status='pending'"),
            safeScalar("SELECT COUNT(*)::int AS value FROM classified_ads WHERE status <> 'active'"),
            safeScalar("SELECT COUNT(*)::int AS value FROM users WHERE subscription_active=true AND (subscription_end IS NULL OR subscription_end > NOW())"),
            safeScalar("SELECT COUNT(*)::int AS value FROM gold_transactions WHERE status IN ('success','completed')"),
            safeScalar("SELECT COALESCE(SUM(gold_grams), 0)::numeric AS value FROM gold_transactions WHERE type IN ('buy','sip') AND status IN ('success','completed') AND gold_grams > 0"),
            safeScalar("SELECT COALESCE(SUM(gold_grams), 0)::numeric AS value FROM gold_transactions WHERE type='sell' AND status IN ('success','completed') AND gold_grams > 0"),
        ]);
        const firebaseUsers = usersSnap?.size || 0;
        const firebasePendingAds = adsSnap?.docs.filter((doc) => {
            const status = doc.data().status;
            return status && status !== "active";
        }).length || 0;
        return res.json({
            users: Math.max(sqlUsers, firebaseUsers),
            revenue,
            pendingKyc,
            pendingAds: pendingAds + firebasePendingAds,
            activeSubscriptions,
            investmentTransactions,
            goldBought,
            goldSold,
        });
    }
    catch (error) {
        console.error("GET DASHBOARD STATS ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
};
exports.getDashboardStats = getDashboardStats;
const getMonitoringOverview = async (_req, res) => {
    try {
        const [users, activeAds, pendingAds, openTickets, activeChats, messages24h, pendingInvestments, pendingKyc, walletTxns24h,] = await Promise.all([
            safeScalar("SELECT COUNT(*)::int AS value FROM users"),
            safeScalar("SELECT COUNT(*)::int AS value FROM classified_ads WHERE status='active'"),
            safeScalar("SELECT COUNT(*)::int AS value FROM classified_ads WHERE status <> 'active'"),
            safeScalar("SELECT COUNT(*)::int AS value FROM support_tickets WHERE status IN ('open','pending')"),
            safeScalar("SELECT COUNT(*)::int AS value FROM chat_conversations WHERE status='active'"),
            safeScalar("SELECT COUNT(*)::int AS value FROM chat_messages WHERE created_at > NOW() - INTERVAL '24 hours'"),
            safeScalar("SELECT COUNT(*)::int AS value FROM gold_transactions WHERE status IN ('pending','created')"),
            safeScalar("SELECT COUNT(*)::int AS value FROM users WHERE kyc_status IN ('pending','submitted','under_review')"),
            safeScalar("SELECT COUNT(*)::int AS value FROM wallet_transactions WHERE created_at > NOW() - INTERVAL '24 hours'"),
        ]);
        return res.json({
            users,
            active_ads: activeAds,
            pending_ads: pendingAds,
            open_tickets: openTickets,
            active_chats: activeChats,
            messages_24h: messages24h,
            pending_investments: pendingInvestments,
            pending_kyc: pendingKyc,
            wallet_txns_24h: walletTxns24h,
            services: {
                database: "online",
                firebase: firebase_1.default.apps.length ? "configured" : "not_configured",
                razorpay: process.env.RAZORPAY_KEY_ID ? "configured" : "missing",
                kycaid: process.env.KYCAID_API_TOKEN ? "configured" : "missing",
                augmont: process.env.AUGMONT_MERCHANT_ID && process.env.AUGMONT_EMAIL ? "configured" : "manual_pending",
            },
            checkedAt: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error("MONITORING OVERVIEW ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch monitoring overview" });
    }
};
exports.getMonitoringOverview = getMonitoringOverview;
const getAuditLogs = async (_req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 100`);
        return res.json(result.rows);
    }
    catch {
        return res.status(500).json({ message: "Failed to fetch audit logs" });
    }
};
exports.getAuditLogs = getAuditLogs;
/* ===============================
   GET ALL USERS (ADMIN)
   =============================== */
const getAllUsers = async (_req, res) => {
    try {
        const [result, usersSnap] = await Promise.all([
            db_1.pool.query(`
      SELECT
        u.id,
        u.firebase_uid AS uid,
        u.name,
        u.phone,
        u.email,
        u.role,
        u.subscription_active AS "subscriptionActive",
        u.subscription_plan AS "subscriptionPlan",
        u.subscription_end AS "subscriptionEnd",
        u.kyc_status AS "kycStatus",
        u.ads_used AS "adsUsed",
        u.ads_limit AS "adsLimit",
        u.shop_lat AS "shopLat",
        u.shop_lng AS "shopLng",
        u.shop_address AS "shopAddress",
        COALESCE(w.balance, 0) AS "walletBalance",
        u.created_at AS "createdAt",
        u.is_blocked
      FROM users u
      LEFT JOIN wallets w ON w.user_id = u.id
      WHERE COALESCE(u.is_deleted, false)=false
      ORDER BY u.created_at DESC
    `),
            firebase_1.default.firestore().collection("users").get().catch(() => null),
        ]);
        const usersByUid = new Map();
        result.rows.forEach((user) => {
            usersByUid.set(user.uid, user);
        });
        usersSnap?.docs.forEach((doc) => {
            if (usersByUid.has(doc.id))
                return;
            const data = doc.data();
            usersByUid.set(doc.id, {
                id: doc.id,
                uid: doc.id,
                name: data.name || "",
                phone: String(data.phone || "").replace("+91", ""),
                walletBalance: Number(data.walletBalance || 0),
                createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
                subscriptionActive: Boolean(data.subscriptionActive),
                subscriptionPlan: data.subscriptionPlan || "",
                adsUsed: Number(data.adsUsed || 0),
                adsLimit: Number(data.adsLimit || 0),
                is_blocked: Boolean(data.isBlocked || data.is_blocked),
            });
        });
        return res.json(Array.from(usersByUid.values()));
    }
    catch (error) {
        console.error("GET USERS ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch users" });
    }
};
exports.getAllUsers = getAllUsers;
/* ===============================
   BLOCK / UNBLOCK USER
   =============================== */
const blockUser = async (req, res) => {
    try {
        const id = String(req.params.id);
        const { is_blocked } = req.body;
        const where = userWhereClause(id, 2);
        if (typeof is_blocked !== "boolean") {
            return res.status(400).json({ message: "Invalid status" });
        }
        const result = await db_1.pool.query(`UPDATE users SET is_blocked=$1 WHERE ${where.clause} RETURNING id`, [is_blocked, where.value]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        return res.json({ success: true });
    }
    catch (error) {
        console.error("BLOCK USER ERROR:", error);
        return res.status(500).json({ message: "Failed to update user" });
    }
};
exports.blockUser = blockUser;
/* ===============================
   ADMIN WALLET ADJUST
   =============================== */
const adjustWallet = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        let { user_id, amount, type } = req.body;
        /* VALIDATION */
        if (!user_id || !amount || !type) {
            return res.status(400).json({ message: "Invalid input" });
        }
        if (!["credit", "debit"].includes(type)) {
            return res.status(400).json({ message: "Invalid type" });
        }
        amount = Number(amount);
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ message: "Invalid amount" });
        }
        await client.query("BEGIN");
        /* GET WALLET */
        const walletRes = await client.query("SELECT balance FROM wallets WHERE user_id=$1", [user_id]);
        if (walletRes.rows.length === 0) {
            throw new Error("Wallet not found");
        }
        const currentBalance = Number(walletRes.rows[0].balance);
        let newBalance = currentBalance;
        /* APPLY LOGIC */
        if (type === "credit") {
            newBalance += amount;
        }
        else {
            if (currentBalance < amount) {
                throw new Error("Insufficient balance");
            }
            newBalance -= amount;
        }
        /* UPDATE WALLET */
        await client.query("UPDATE wallets SET balance=$1 WHERE user_id=$2", [newBalance, user_id]);
        /* INSERT TRANSACTION */
        await client.query(`INSERT INTO wallet_transactions
       (user_id, type, amount, method, status)
       VALUES ($1, $2, $3, 'admin', 'success')`, [user_id, type, amount]);
        await client.query("COMMIT");
        return res.json({
            success: true,
            balance: newBalance,
        });
    }
    catch (error) {
        await client.query("ROLLBACK");
        console.error("ADJUST WALLET ERROR:", error);
        return res.status(500).json({
            message: error.message,
        });
    }
    finally {
        client.release();
    }
};
exports.adjustWallet = adjustWallet;
/* ===============================
   GET ALL TRANSACTIONS (ADMIN)
   =============================== */
const getAllTransactions = async (_req, res) => {
    try {
        const result = await db_1.pool.query(`
      SELECT
        wt.id::text AS id,
        wt.user_id,
        u.name,
        u.phone,
        wt.type,
        wt.amount,
        wt.method,
        wt.status,
        wt.reference_id,
        wt.created_at,
        'wallet'::text AS source
      FROM wallet_transactions wt
      LEFT JOIN users u ON u.id = wt.user_id

      UNION ALL

      SELECT
        ci.id,
        ci.user_id,
        u.name,
        u.phone,
        'debit'::text AS type,
        ci.amount,
        CASE WHEN ci.purpose='digital_gold'
          THEN 'razorpay_digital_gold'
          ELSE 'razorpay_product' END AS method,
        ci.status,
        ci.razorpay_payment_id AS reference_id,
        ci.created_at,
        'checkout'::text AS source
      FROM checkout_intents ci
      LEFT JOIN users u ON u.id=ci.user_id
      WHERE ci.razorpay_payment_id IS NOT NULL

      ORDER BY created_at DESC
    `);
        return res.json(result.rows);
    }
    catch (error) {
        console.error("GET TRANSACTIONS ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch transactions" });
    }
};
exports.getAllTransactions = getAllTransactions;
/* ===============================
   CREATE USER (ADMIN)
   =============================== */
const createAdminUser = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        const uid = String(req.body.uid || `admin_${Date.now()}`);
        const name = String(req.body.name || "").trim();
        const phone = String(req.body.phone || "").trim();
        const email = String(req.body.email || "").trim();
        const role = String(req.body.role || "buyer").toLowerCase();
        const city = String(req.body.city || "").trim();
        if (rejectElevatedRoleChange(req, res, role))
            return;
        const adsLimit = Number(req.body.adsLimit ?? (postingBypassRoles.includes(role) ? 999 : 0));
        await client.query("BEGIN");
        const result = await client.query(`INSERT INTO users
       (firebase_uid, name, phone, email, role, city, profile_completed, ads_limit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`, [uid, name, phone, email, role, city, Boolean(name || phone || email), adsLimit]);
        await client.query(`INSERT INTO wallets (user_id, balance)
       VALUES ($1, 0)
       ON CONFLICT DO NOTHING`, [result.rows[0].id]);
        await client.query("COMMIT");
        return res.status(201).json({ success: true, user: result.rows[0] });
    }
    catch (error) {
        await client.query("ROLLBACK");
        console.error("CREATE USER ERROR:", error);
        return res.status(500).json({ message: "Failed to create user" });
    }
    finally {
        client.release();
    }
};
exports.createAdminUser = createAdminUser;
/* ===============================
   UPDATE USER (ADMIN)
   =============================== */
const updateAdminUser = async (req, res) => {
    try {
        const allowedFields = {
            name: "name",
            phone: "phone",
            email: "email",
            city: "city",
            role: "role",
            subscriptionActive: "subscription_active",
            subscriptionPlan: "subscription_plan",
            subscriptionEnd: "subscription_end",
            kycStatus: "kyc_status",
            adsUsed: "ads_used",
            adsLimit: "ads_limit",
            shopLat: "shop_lat",
            shopLng: "shop_lng",
            shopAddress: "shop_address",
            isBlocked: "is_blocked",
            is_blocked: "is_blocked",
        };
        const updates = [];
        const values = [];
        if (req.body.role !== undefined && rejectElevatedRoleChange(req, res, req.body.role))
            return;
        Object.entries(allowedFields).forEach(([bodyKey, column]) => {
            if (req.body[bodyKey] === undefined)
                return;
            values.push(req.body[bodyKey]);
            updates.push(`${column}=$${values.length}`);
        });
        if (updates.length === 0) {
            return res.status(400).json({ message: "No editable fields provided" });
        }
        const where = userWhereClause(String(req.params.id), values.length + 1);
        values.push(where.value);
        const result = await db_1.pool.query(`UPDATE users
       SET ${updates.join(", ")}
       WHERE ${where.clause}
       RETURNING *`, values);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        return res.json({ success: true, user: result.rows[0] });
    }
    catch (error) {
        console.error("UPDATE USER ERROR:", error);
        return res.status(500).json({ message: "Failed to update user" });
    }
};
exports.updateAdminUser = updateAdminUser;
/* ===============================
   DELETE USER (ADMIN)
   =============================== */
const deleteAdminUser = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        await client.query("BEGIN");
        const lookup = userWhereClause(String(req.params.id), 1);
        const user = await client.query(`SELECT id FROM users WHERE ${lookup.clause} LIMIT 1`, [lookup.value]);
        if (user.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "User not found" });
        }
        const userId = user.rows[0].id;
        await client.query("UPDATE classified_ads SET status='deleted' WHERE user_id=$1", [userId]);
        await client.query("UPDATE users SET is_blocked=true, is_deleted=true WHERE id=$1", [userId]);
        await client.query("COMMIT");
        return res.json({ success: true });
    }
    catch (error) {
        await client.query("ROLLBACK");
        console.error("DELETE USER ERROR:", error);
        return res.status(500).json({ message: "Failed to delete user" });
    }
    finally {
        client.release();
    }
};
exports.deleteAdminUser = deleteAdminUser;
const getAllGoldTransactions = async (req, res) => {
    try {
        const view = String(req.query.view || "settled").toLowerCase();
        let query;
        if (view === "settlements") {
            query = `
        SELECT
          ams.id,
          gt.user_id,
          gt.augmont_txn_id,
          gt.merchant_txn_id,
          'augmont_merchant'::text AS provider,
          NULL::jsonb AS provider_payload,
          gt.type,
          ams.amount,
          gt.gold_grams,
          ams.status,
          ams.settled_at,
          ams.created_at,
          NULL::text AS checkout_id,
          NULL::text AS razorpay_payment_id,
          NULL::text AS error_message,
          'merchant_settlement'::text AS source,
          u.name,
          u.phone,
          ams.direction,
          ams.due_date,
          ams.settlement_reference,
          ams.settled_amount,
          ams.admin_notes,
          (ams.status <> 'settled' AND ams.due_date <
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS overdue
        FROM augmont_merchant_settlements ams
        JOIN gold_transactions gt ON gt.id=ams.gold_transaction_id
        LEFT JOIN users u ON u.id=gt.user_id
        ORDER BY
          CASE WHEN ams.status <> 'settled' THEN 0 ELSE 1 END,
          ams.due_date ASC,
          ams.created_at DESC`;
        }
        else if (view === "payouts") {
            query = `
        SELECT
          gt.*,
          NULL::text AS checkout_id,
          NULL::text AS razorpay_payment_id,
          NULL::text AS error_message,
          'sell_payout'::text AS source,
          u.name,
          u.phone
        FROM gold_transactions gt
        LEFT JOIN users u ON u.id=gt.user_id
        WHERE gt.type='sell'
          AND gt.payout_route='augmont_direct'
        ORDER BY gt.created_at DESC`;
        }
        else if (view === "pending") {
            query = `
        SELECT
          ci.id,
          ci.user_id,
          NULL::text AS augmont_txn_id,
          ci.metadata->>'merchantTransactionId' AS merchant_txn_id,
          'razorpay_augmont'::text AS provider,
          ci.provider_payload,
          'buy'::text AS type,
          ci.amount,
          0::numeric AS gold_grams,
          ci.status,
          NULL::timestamptz AS settled_at,
          ci.created_at,
          ci.id AS checkout_id,
          ci.razorpay_payment_id,
          ci.error_message,
          'captured_checkout'::text AS source,
          u.name,
          u.phone
        FROM checkout_intents ci
        LEFT JOIN users u ON u.id=ci.user_id
        WHERE ci.purpose='digital_gold'
          AND ci.razorpay_payment_id IS NOT NULL
          AND ci.status IN ('processing','provider_pending')
        ORDER BY ci.created_at DESC`;
        }
        else if (view === "attempts") {
            query = `
        SELECT
          gt.*,
          NULL::text AS checkout_id,
          NULL::text AS razorpay_payment_id,
          NULL::text AS error_message,
          'gold_attempt'::text AS source,
          u.name,
          u.phone
        FROM gold_transactions gt
        LEFT JOIN users u ON u.id=gt.user_id
        WHERE NOT (
          LOWER(COALESCE(gt.status,'')) IN ('success','completed')
          AND COALESCE(gt.gold_grams,0) > 0
          AND COALESCE(gt.augmont_txn_id,'') <> ''
        )
        ORDER BY gt.created_at DESC`;
        }
        else {
            query = `
        SELECT
          gt.*,
          ci.id AS checkout_id,
          ci.razorpay_payment_id,
          ci.error_message,
          'settled_investment'::text AS source,
          u.name,
          u.phone
        FROM gold_transactions gt
        LEFT JOIN users u ON u.id=gt.user_id
        LEFT JOIN checkout_intents ci
          ON ci.purpose='digital_gold'
         AND ci.metadata->>'merchantTransactionId'=gt.merchant_txn_id
        WHERE LOWER(COALESCE(gt.status,'')) IN ('success','completed')
          AND COALESCE(gt.gold_grams,0) > 0
          AND COALESCE(gt.augmont_txn_id,'') <> ''
        ORDER BY gt.created_at DESC`;
        }
        const result = await db_1.pool.query(query);
        return res.json(result.rows);
    }
    catch (error) {
        console.error("GET GOLD TRANSACTIONS ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch gold transactions" });
    }
};
exports.getAllGoldTransactions = getAllGoldTransactions;
const confirmAugmontMerchantSettlement = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        const reference = String(req.body.settlementReference || req.body.settlement_reference || "").trim();
        const settledAmount = Number(req.body.settledAmount ?? req.body.settled_amount);
        const confirmed = req.body.settlementConfirmed === true;
        const notes = String(req.body.adminNotes || req.body.admin_notes || "").trim();
        if (!confirmed || !reference) {
            return res.status(400).json({
                message: "Confirm the bank movement and enter its settlement reference",
            });
        }
        if (!Number.isFinite(settledAmount) || settledAmount <= 0) {
            return res.status(400).json({ message: "Enter the confirmed settlement amount" });
        }
        await client.query("BEGIN");
        const existing = await client.query(`SELECT * FROM augmont_merchant_settlements WHERE id=$1 FOR UPDATE`, [req.params.id]);
        const current = existing.rows[0];
        if (!current) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Augmont settlement was not found" });
        }
        if (String(current.status) === "settled") {
            await client.query("COMMIT");
            return res.json({ success: true, idempotentReplay: true, settlement: current });
        }
        const expectedAmount = Number(current.amount || 0);
        const { variance, status } = (0, augmont_merchant_settlement_service_1.settlementAmountResult)(expectedAmount, settledAmount);
        const result = await client.query(`UPDATE augmont_merchant_settlements
       SET status=$1,
           settlement_reference=$2,
           settled_amount=$3,
           admin_notes=COALESCE(NULLIF($4,''),admin_notes),
           settled_at=CASE WHEN $1='settled' THEN NOW() ELSE NULL END,
           updated_at=NOW()
       WHERE id=$5
       RETURNING *`, [status, reference, settledAmount, notes, req.params.id]);
        await client.query("COMMIT");
        await createAdminAuditLog("augmont_merchant_settlement_confirmed", "augmont_merchant_settlement", String(req.params.id), {
            direction: current.direction,
            expectedAmount,
            settledAmount,
            variance,
            reference,
            status,
        });
        return res.status(status === "settled" ? 200 : 409).json({
            success: status === "settled",
            status,
            variance,
            settlement: result.rows[0],
            message: status === "settled"
                ? "Augmont merchant settlement recorded."
                : "The confirmed amount differs from the expected amount and requires review.",
        });
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => null);
        console.error("CONFIRM AUGMONT SETTLEMENT ERROR:", error);
        return res.status(500).json({ message: "Failed to record Augmont settlement" });
    }
    finally {
        client.release();
    }
};
exports.confirmAugmontMerchantSettlement = confirmAugmontMerchantSettlement;
const reconcileDigitalGoldCheckout = async (req, res) => {
    try {
        const settlement = await (0, digital_gold_settlement_service_1.settleDigitalGoldCheckout)({
            checkoutId: String(req.params.id || ""),
        });
        return res.status(settlement.status === "processing" ? 202 : 200).json(settlement);
    }
    catch (error) {
        return res.status(409).json({
            success: false,
            status: "provider_pending",
            message: error?.message || "Digital gold reconciliation is still pending",
        });
    }
};
exports.reconcileDigitalGoldCheckout = reconcileDigitalGoldCheckout;
const reconcileDigitalGoldSalePayout = async (req, res) => {
    try {
        const result = await (0, digital_gold_sale_settlement_service_1.reconcileDigitalGoldSale)({
            transactionId: Number(req.params.id),
        });
        return res.status(result.status === "completed" ? 200 : 202).json(result);
    }
    catch (error) {
        return res.status(409).json({
            success: false,
            status: "payout_pending",
            message: error?.message || "Augmont payout confirmation is still pending",
        });
    }
};
exports.reconcileDigitalGoldSalePayout = reconcileDigitalGoldSalePayout;
/* ===============================
   GET ALL ADS (ADMIN)
   =============================== */
const getAllAds = async (_req, res) => {
    try {
        const [result, adsSnap] = await Promise.all([
            db_1.pool.query(`
      SELECT
        ca.id,
        ca.title,
        ca.description,
        ca.grams,
        ca.purity,
        ca.price,
        ca.city,
        ca.status,
        ca.created_at,
        u.name,
        u.phone
      FROM classified_ads ca
      LEFT JOIN users u ON u.id = ca.user_id
      ORDER BY ca.created_at DESC
    `),
            firebase_1.default.firestore().collection("ads").get().catch(() => null),
        ]);
        const adsById = new Map();
        result.rows.forEach((ad) => {
            adsById.set(String(ad.id), ad);
        });
        adsSnap?.docs.forEach((doc) => {
            if (adsById.has(doc.id))
                return;
            const data = doc.data();
            adsById.set(doc.id, {
                id: doc.id,
                title: data.title || "",
                description: data.description || "",
                grams: Number(data.weight || 0),
                purity: data.purity || "",
                price: Number(data.price || 0),
                city: data.city || "",
                status: data.status || "inactive",
                created_at: data.createdAt?.toDate?.()?.toISOString?.() || null,
                name: data.sellerName || "",
                phone: "",
            });
        });
        return res.json(Array.from(adsById.values()));
    }
    catch (error) {
        console.error("GET ADS ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch ads" });
    }
};
exports.getAllAds = getAllAds;
const getOrCreateExGoldSeller = async () => {
    const existing = await db_1.pool.query("SELECT id FROM users WHERE firebase_uid=$1 LIMIT 1", ["internal_exgold"]);
    if (existing.rows.length > 0)
        return existing.rows[0].id;
    const created = await db_1.pool.query(`INSERT INTO users
     (firebase_uid, name, phone, role, city, profile_completed, ads_limit)
     VALUES ('internal_exgold','ExGold','','internal','',true,999)
     RETURNING id`);
    await db_1.pool.query(`INSERT INTO wallets (user_id, balance)
     VALUES ($1, 0)
     ON CONFLICT DO NOTHING`, [created.rows[0].id]);
    return created.rows[0].id;
};
/* ===============================
   CREATE AD / PRODUCT (ADMIN)
   =============================== */
const createAdminAd = async (req, res) => {
    try {
        const purity = parseKarat(req.body.purity || req.body.karat || 22) || 22;
        const grams = Number(req.body.grams || req.body.weight || 0);
        const condition = String(req.body.condition || "New");
        const isNewGold = condition.toLowerCase() === "new";
        const wastage = Number(req.body.wastage || 0);
        const makingCharges = Number(req.body.makingCharge || req.body.making_charges || 0);
        const rateResult = await db_1.pool.query("SELECT price_per_gram FROM gold_rates WHERE regexp_replace(karat::text, '[^0-9]', '', 'g')::int=$1 LIMIT 1", [purity]);
        const goldRate = Number(rateResult.rows[0]?.price_per_gram || 0);
        const marketPrice = goldRate * grams;
        const price = isNewGold
            ? Math.round(marketPrice + marketPrice * (wastage / 100) + makingCharges)
            : Number(req.body.price || 0);
        if (!req.body.title || grams <= 0 || price <= 0) {
            return res.status(400).json({ message: "Title, weight and price are required" });
        }
        if (!isNewGold && marketPrice > 0 && price > marketPrice) {
            return res.status(400).json({ message: "Old gold price cannot be above market value" });
        }
        const userId = req.body.userId || req.body.user_id || await getOrCreateExGoldSeller();
        const result = await db_1.pool.query(`INSERT INTO classified_ads
       (user_id, title, description, grams, purity, wastage, making_charges,
        gold_rate_snapshot, price, city, category_id, metal, condition, images,
        seller_name, seller_role, shop_address, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`, [
            userId,
            req.body.title,
            req.body.description || "",
            grams,
            purity,
            isNewGold ? wastage : 0,
            isNewGold ? makingCharges : 0,
            price,
            req.body.city || "",
            req.body.categoryId || req.body.category_id || "",
            req.body.metal || "Gold",
            condition,
            Array.isArray(req.body.images) ? req.body.images : [],
            req.body.sellerName || "ExGold",
            req.body.sellerRole || "shop",
            req.body.shopAddress || "",
            req.body.status || "active",
        ]);
        return res.status(201).json({ success: true, ad: result.rows[0] });
    }
    catch (error) {
        console.error("CREATE AD ERROR:", error);
        return res.status(500).json({ message: "Failed to create ad" });
    }
};
exports.createAdminAd = createAdminAd;
/* ===============================
   UPDATE AD / PRODUCT (ADMIN)
   =============================== */
const updateAdminAd = async (req, res) => {
    try {
        const allowedFields = {
            title: "title",
            description: "description",
            grams: "grams",
            weight: "grams",
            purity: "purity",
            wastage: "wastage",
            makingCharge: "making_charges",
            making_charges: "making_charges",
            price: "price",
            city: "city",
            status: "status",
            categoryId: "category_id",
            category_id: "category_id",
            metal: "metal",
            condition: "condition",
            images: "images",
            sellerName: "seller_name",
            sellerRole: "seller_role",
            shopAddress: "shop_address",
        };
        const updates = [];
        const values = [];
        Object.entries(allowedFields).forEach(([bodyKey, column]) => {
            if (req.body[bodyKey] === undefined)
                return;
            let value = req.body[bodyKey];
            if (bodyKey === "purity")
                value = parseKarat(value) || 22;
            values.push(value);
            updates.push(`${column}=$${values.length}`);
        });
        if (updates.length === 0) {
            return res.status(400).json({ message: "No editable fields provided" });
        }
        values.push(req.params.id);
        const result = await db_1.pool.query(`UPDATE classified_ads
       SET ${updates.join(", ")}
       WHERE id=$${values.length}
       RETURNING *`, values);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Ad not found" });
        }
        return res.json({ success: true, ad: result.rows[0] });
    }
    catch (error) {
        console.error("UPDATE AD ERROR:", error);
        return res.status(500).json({ message: "Failed to update ad" });
    }
};
exports.updateAdminAd = updateAdminAd;
/* ===============================
   DELETE AD / PRODUCT (ADMIN)
   =============================== */
const deleteAdminAd = async (req, res) => {
    try {
        const result = await db_1.pool.query("UPDATE classified_ads SET status='deleted' WHERE id=$1 RETURNING *", [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Ad not found" });
        }
        return res.json({ success: true });
    }
    catch (error) {
        console.error("DELETE AD ERROR:", error);
        return res.status(500).json({ message: "Failed to delete ad" });
    }
};
exports.deleteAdminAd = deleteAdminAd;
/* ===============================
   APPROVE AD (ADMIN)
   =============================== */
const approveAd = async (req, res) => {
    try {
        const id = String(req.params.id);
        const numericId = Number(id);
        if (!Number.isNaN(numericId)) {
            const result = await db_1.pool.query(`UPDATE classified_ads
         SET status = 'active'
         WHERE id = $1
         RETURNING *`, [numericId]);
            if (result.rows.length > 0) {
                return res.json({ success: true, ad: result.rows[0] });
            }
        }
        const adRef = firebase_1.default.firestore().collection("ads").doc(id);
        const adSnap = await adRef.get();
        if (!adSnap.exists) {
            return res.status(404).json({ message: "Ad not found" });
        }
        await adRef.set({
            status: "active",
            updatedAt: firebase_1.default.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return res.json({ success: true, ad: { id, ...adSnap.data(), status: "active" } });
    }
    catch (error) {
        console.error("APPROVE AD ERROR:", error);
        return res.status(500).json({ message: "Failed to approve ad" });
    }
};
exports.approveAd = approveAd;
/* ===============================
   GET ALL KYC REQUESTS (ADMIN)
   =============================== */
const getAllKyc = async (_req, res) => {
    try {
        const result = await db_1.pool.query(`
      SELECT
        k.id,
        k.user_id,
        u.name,
        u.phone,
        k.status,
        k.reference_id,
        k.aadhaar_status,
        k.pan_status,
        k.video_status,
        k.aadhaar_reference_id,
        k.pan_reference_id,
        k.video_reference_id,
        k.reference_id,
        k.nerotix_txn_id,
        k.nerotix_reference_id,
        k.aadhaar_masked,
        k.pan_masked,
        k.pan_name,
        k.aadhaar_payload,
        k.nerotix_payload,
        k.kyc_provider,
        k.kyc_expires_at,
        k.kyc_reverify_reason,
        k.created_at
      FROM kyc k
      LEFT JOIN users u ON u.id = k.user_id
      ORDER BY k.created_at DESC
    `);
        return res.json(result.rows.map((row) => {
            const { aadhaar_payload, nerotix_payload, ...safeRow } = row;
            const evidence = (0, kyc_evidence_1.selectNerotixAadhaarEvidence)(aadhaar_payload, nerotix_payload);
            return {
                ...safeRow,
                aadhaar_masked: row.aadhaar_masked || evidence.masked,
                aadhaar_verified_via: evidence.verifiedVia,
                aadhaar_verified_name: evidence.verified ? evidence.name : null,
                aadhaar_verified_dob: evidence.verified ? evidence.dob : null,
                aadhaar_verified_year: evidence.verified ? evidence.yearOfBirth : null,
                aadhaar_verified_gender: evidence.verified ? evidence.gender : null,
                pan_masked: row.pan_masked || maskPan(row.pan_number),
                status: kycOverallStatus(row),
            };
        }));
    }
    catch (error) {
        console.error("GET KYC ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch KYC requests" });
    }
};
exports.getAllKyc = getAllKyc;
/* ===============================
   UPDATE KYC STATUS (ADMIN)
   =============================== */
const updateKycStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const step = String(req.params.step || req.body.step || "").toLowerCase();
        if (!["approved", "rejected"].includes(status)) {
            return res.status(400).json({ message: "Invalid KYC status" });
        }
        const stepColumns = {
            aadhaar: "aadhaar_status",
            pan: "pan_status",
            video: "video_status",
        };
        const setClause = stepColumns[step]
            ? `${stepColumns[step]} = $1,`
            : `aadhaar_status = $1, pan_status = $1, video_status = $1,`;
        const result = await db_1.pool.query(`UPDATE kyc
       SET ${setClause}
           status = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`, [status, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "KYC request not found" });
        }
        const kyc = result.rows[0];
        const userKycStatus = kycOverallStatus(kyc);
        const kycVerified = userKycStatus === "full";
        await db_1.pool.query(`UPDATE users
       SET kyc_status = $1,
           kyc_verified = $2,
           kyc_completed_at = CASE WHEN $2 THEN COALESCE(kyc_completed_at, NOW()) ELSE kyc_completed_at END
       WHERE id = $3`, [userKycStatus, kycVerified, kyc.user_id]);
        await db_1.pool.query(`UPDATE kyc
       SET status = $1,
           kyc_expires_at = CASE WHEN $3 THEN COALESCE(kyc_expires_at, NOW() + ($4::text || ' days')::interval) ELSE kyc_expires_at END,
           updated_at = NOW()
       WHERE id = $2`, [userKycStatus, kyc.id, kycVerified, kycValidityDays]);
        await createAdminAuditLog("kyc_status_update", "kyc", String(kyc.id), {
            actor: req.user?.email || "admin",
            user_id: kyc.user_id,
            step: step || "all",
            status,
            overall_status: userKycStatus,
            verified: kycVerified,
        });
        return res.json({ success: true, kyc: { ...kyc, userKycStatus } });
    }
    catch (error) {
        console.error("UPDATE KYC ERROR:", error);
        return res.status(500).json({ message: "Failed to update KYC request" });
    }
};
exports.updateKycStatus = updateKycStatus;
/* ===============================
   FORCE KYC REVERIFY (ADMIN)
   =============================== */
const forceKycReverify = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        const id = Number(req.params.id);
        const reason = String(req.body?.reason || "Admin requested re-verification").trim();
        const scope = String(req.body?.scope || "both").trim().toLowerCase();
        if (!Number.isInteger(id)) {
            return res.status(400).json({ message: "Invalid KYC request" });
        }
        if (!["aadhaar", "pan", "both"].includes(scope)) {
            return res.status(400).json({ message: "Re-verification scope must be Aadhaar, PAN, or both" });
        }
        if (reason.length < 3 || reason.length > 300) {
            return res.status(400).json({ message: "Enter a re-verification reason between 3 and 300 characters" });
        }
        await client.query("BEGIN");
        const existing = await client.query(`SELECT * FROM kyc WHERE id=$1 FOR UPDATE`, [id]);
        if (existing.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "KYC request not found" });
        }
        const resetAadhaar = scope === "aadhaar" || scope === "both";
        const resetPan = scope === "pan" || scope === "both";
        const result = await client.query(`UPDATE kyc
       SET aadhaar_status=CASE WHEN $2 THEN 'none' ELSE aadhaar_status END,
           pan_status=CASE WHEN $3 THEN 'none' ELSE pan_status END,
           reference_id=CASE WHEN $2 THEN NULL ELSE reference_id END,
           aadhaar_reference_id=CASE WHEN $2 THEN NULL ELSE aadhaar_reference_id END,
           nerotix_txn_id=CASE WHEN $2 THEN NULL ELSE nerotix_txn_id END,
           nerotix_reference_id=CASE WHEN $2 THEN NULL ELSE nerotix_reference_id END,
           nerotix_payload=CASE WHEN $2 THEN NULL ELSE nerotix_payload END,
           aadhaar_payload=CASE WHEN $2 THEN NULL ELSE aadhaar_payload END,
           aadhaar_masked=CASE WHEN $2 THEN NULL ELSE aadhaar_masked END,
           kycaid_applicant_id=CASE WHEN $2 THEN NULL ELSE kycaid_applicant_id END,
           kycaid_verification_id=CASE WHEN $2 THEN NULL ELSE kycaid_verification_id END,
           kycaid_form_url=CASE WHEN $2 THEN NULL ELSE kycaid_form_url END,
           kycaid_payload=CASE WHEN $2 THEN NULL ELSE kycaid_payload END,
           pan_reference_id=CASE WHEN $3 THEN NULL ELSE pan_reference_id END,
           pan_payload=CASE WHEN $3 THEN NULL ELSE pan_payload END,
           pan_masked=CASE WHEN $3 THEN NULL ELSE pan_masked END,
           pan_number=CASE WHEN $3 THEN NULL ELSE pan_number END,
           pan_name=CASE WHEN $3 THEN NULL ELSE pan_name END,
           kyc_expires_at=NULL,
           augmont_kyc_status=NULL,
           augmont_kyc_synced_at=NULL,
           augmont_kyc_payload=NULL,
           augmont_kyc_error=NULL,
           kyc_reverify_reason=$4,
           updated_at=NOW()
       WHERE id=$1
       RETURNING *`, [id, resetAadhaar, resetPan, reason]);
        let kyc = result.rows[0];
        const nextStatus = kycOverallStatus({ ...kyc, status: "" });
        const statusResult = await client.query(`UPDATE kyc SET status=$2, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, nextStatus]);
        kyc = statusResult.rows[0];
        await client.query(`UPDATE users
       SET kyc_status=$2,
           kyc_verified=false,
           kyc_completed_at=NULL
       WHERE id=$1`, [kyc.user_id, nextStatus]);
        await client.query(`INSERT INTO admin_audit_logs (action, entity_type, entity_id, actor, metadata)
       VALUES ($1,$2,$3,$4,$5)`, [
            "kyc_reverify_required",
            "kyc",
            String(kyc.id),
            req.user?.email || "admin",
            {
                user_id: kyc.user_id,
                reason,
                scope,
                preserved_aadhaar: !resetAadhaar,
                preserved_pan: !resetPan,
            },
        ]).catch(() => null);
        await client.query("COMMIT");
        return res.json({
            success: true,
            scope,
            kyc: {
                id: kyc.id,
                user_id: kyc.user_id,
                status: kyc.status,
                aadhaar_status: kyc.aadhaar_status,
                pan_status: kyc.pan_status,
                kyc_reverify_reason: kyc.kyc_reverify_reason,
            },
        });
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => null);
        console.error("FORCE KYC REVERIFY ERROR:", error);
        return res.status(500).json({ message: "Failed to force KYC reverify" });
    }
    finally {
        client.release();
    }
};
exports.forceKycReverify = forceKycReverify;
/* ===============================
   GET GOLD RATES (ADMIN)
   =============================== */
const getAdminGoldRates = async (_req, res) => {
    try {
        const [result, historyResult] = await Promise.all([
            db_1.pool.query(`
      SELECT DISTINCT ON (normalized_karat)
        normalized_karat AS karat,
        price_per_gram,
        updated_at
      FROM (
        SELECT
          regexp_replace(karat::text, '[^0-9]', '', 'g')::int AS normalized_karat,
          price_per_gram,
          updated_at
        FROM gold_rates
        WHERE regexp_replace(karat::text, '[^0-9]', '', 'g') ~ '^[0-9]+$'
      ) rates
      WHERE normalized_karat IN (18, 22, 24)
      ORDER BY normalized_karat, updated_at DESC
    `),
            db_1.pool.query(`
        SELECT karat, price_per_gram, source, created_at
        FROM gold_rate_history
        ORDER BY created_at DESC
        LIMIT 20
      `).catch(() => ({ rows: [] })),
        ]);
        const rates = result.rows.reduce((acc, row) => ({
            ...acc,
            [`k${row.karat}`]: row.price_per_gram,
            updatedAt: row.updated_at,
        }), { k24: "", k22: "", k18: "" });
        return res.json({ ...rates, history: historyResult.rows });
    }
    catch (error) {
        console.error("GET GOLD RATES ERROR:", error);
        return res.status(500).json({ message: "Failed to fetch gold rates" });
    }
};
exports.getAdminGoldRates = getAdminGoldRates;
/* ===============================
   UPDATE GOLD RATES (ADMIN)
   =============================== */
const updateAdminGoldRates = async (req, res) => {
    const client = await db_1.pool.connect();
    try {
        const rates = [
            { karat: 24, price: Number(req.body.k24) },
            { karat: 22, price: Number(req.body.k22) },
            { karat: 18, price: Number(req.body.k18) },
        ];
        if (rates.some((rate) => Number.isNaN(rate.price) || rate.price <= 0)) {
            return res.status(400).json({ message: "Invalid gold rate" });
        }
        await client.query("BEGIN");
        await client.query(`
      CREATE TABLE IF NOT EXISTS gold_rates (
        karat INTEGER PRIMARY KEY,
        price_per_gram NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await client.query(`
      ALTER TABLE gold_rates
      ADD COLUMN IF NOT EXISTS karat INTEGER,
      ADD COLUMN IF NOT EXISTS price_per_gram NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);
        await client.query(`
      CREATE TABLE IF NOT EXISTS gold_rate_history (
        id SERIAL PRIMARY KEY,
        karat INTEGER NOT NULL,
        price_per_gram NUMERIC NOT NULL,
        source TEXT DEFAULT 'admin',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await client.query(`
      ALTER TABLE gold_rate_history
      ADD COLUMN IF NOT EXISTS karat INTEGER,
      ADD COLUMN IF NOT EXISTS price_per_gram NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'admin',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);
        for (const rate of rates) {
            const updated = await client.query(`UPDATE gold_rates
         SET price_per_gram=$1, updated_at=NOW()
         WHERE karat::text=$2::text`, [rate.price, rate.karat]);
            if (updated.rowCount === 0) {
                await client.query(`INSERT INTO gold_rates (karat, price_per_gram, updated_at)
           VALUES ($1, $2, NOW())`, [rate.karat, rate.price]);
            }
            await client.query(`INSERT INTO gold_rate_history (karat, price_per_gram, source)
         VALUES ($1,$2,'admin')`, [rate.karat, rate.price]);
        }
        await client.query("COMMIT");
        firebase_1.default.firestore().collection("gold_rates").doc("today").set({
            price_24k: rates.find((rate) => rate.karat === 24)?.price,
            price_22k: rates.find((rate) => rate.karat === 22)?.price,
            price_18k: rates.find((rate) => rate.karat === 18)?.price,
            updated_at: firebase_1.default.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }).catch((error) => {
            console.warn("GOLD RATE FIRESTORE MIRROR SKIPPED:", error?.message || error);
        });
        return res.json({ success: true });
    }
    catch (error) {
        await client.query("ROLLBACK");
        console.error("UPDATE GOLD RATES ERROR:", error);
        return res.status(500).json({ message: "Failed to update gold rates" });
    }
    finally {
        client.release();
    }
};
exports.updateAdminGoldRates = updateAdminGoldRates;
/* ===============================
   UPDATE GOLD MARGIN (ADMIN)
   =============================== */
const updateGoldMargin = async (req, res) => {
    try {
        const karat = parseKarat(req.body.karat);
        const buyMargin = Number(req.body.buy_margin);
        const sellMargin = Number(req.body.sell_margin);
        if (!karat) {
            return res.status(400).json({ message: "Invalid karat" });
        }
        if (Number.isNaN(buyMargin) ||
            Number.isNaN(sellMargin) ||
            buyMargin < 0 ||
            sellMargin < 0) {
            return res.status(400).json({ message: "Invalid margin" });
        }
        const result = await db_1.pool.query(`INSERT INTO gold_margin (karat, buy_margin, sell_margin, updated_at)
       VALUES ($3, $1, $2, NOW())
       ON CONFLICT (karat)
       DO UPDATE SET buy_margin = EXCLUDED.buy_margin,
                     sell_margin = EXCLUDED.sell_margin,
                     updated_at = NOW()
       RETURNING *`, [buyMargin, sellMargin, karat]);
        return res.json({ success: true, margin: result.rows[0] });
    }
    catch (error) {
        console.error("UPDATE GOLD MARGIN ERROR:", error);
        return res.status(500).json({ message: "Failed to update gold margin" });
    }
};
exports.updateGoldMargin = updateGoldMargin;
