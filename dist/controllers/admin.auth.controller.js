"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetAdminPassword = exports.adminMe = exports.forgotAdminPassword = exports.adminLogin = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../config/db");
const mail_service_1 = require("../services/mail.service");
const JWT_SECRET = process.env.JWT_SECRET || "secretkey";
const ADMIN_APP_URL = process.env.ADMIN_APP_URL || "https://app.exgold.in";
const RESET_TOKEN_TTL_MINUTES = 30;
const hashResetToken = (token) => crypto_1.default.createHash("sha256").update(token).digest("hex");
const adminLogin = async (req, res) => {
    try {
        const emailOrUsername = String(req.body.email || req.body.username || "").trim().toLowerCase();
        const { password } = req.body;
        /* ===============================
           VALIDATION
        =============================== */
        if (!emailOrUsername || !password) {
            return res.status(400).json({
                success: false,
                message: "Username/email and password are required",
            });
        }
        /* ===============================
           GET ADMIN USER
        =============================== */
        const result = await db_1.pool.query(`
      SELECT 
        id,
        username,
        email,
        password,
        role,
        status,
        created_at
      FROM admins
      WHERE LOWER(email) = $1 OR LOWER(COALESCE(username, '')) = $1
      LIMIT 1
      `, [emailOrUsername]);
        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid credentials",
            });
        }
        const admin = result.rows[0];
        /* ===============================
           STATUS CHECK
        =============================== */
        if (admin.status && admin.status === "blocked") {
            return res.status(403).json({
                success: false,
                message: "Account blocked",
            });
        }
        /* ===============================
           PASSWORD CHECK
           Supports both:
           1. Plain text old passwords
           2. bcrypt hashed passwords
        =============================== */
        let passwordMatched = false;
        if (admin.password &&
            (admin.password.startsWith("$2a$") ||
                admin.password.startsWith("$2b$") ||
                admin.password.startsWith("$2y$"))) {
            passwordMatched = await bcryptjs_1.default.compare(password, admin.password);
        }
        else {
            passwordMatched = admin.password === password;
        }
        if (!passwordMatched) {
            return res.status(401).json({
                success: false,
                message: "Invalid credentials",
            });
        }
        /* ===============================
           UPDATE LAST LOGIN
        =============================== */
        await db_1.pool.query(`
      UPDATE admins
      SET last_login = NOW()
      WHERE id = $1
      `, [admin.id]);
        /* ===============================
           JWT TOKEN
        =============================== */
        const token = jsonwebtoken_1.default.sign({
            id: admin.id,
            username: admin.username || admin.email,
            email: admin.email,
            role: admin.role || "admin",
        }, JWT_SECRET, {
            expiresIn: "1d",
        });
        /* ===============================
           RESPONSE
        =============================== */
        return res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            admin: {
                id: admin.id,
                username: admin.username || admin.email,
                email: admin.email,
                role: admin.role || "admin",
            },
        });
    }
    catch (error) {
        console.error("Admin login error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
exports.adminLogin = adminLogin;
const forgotAdminPassword = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }
        const adminResult = await db_1.pool.query("SELECT id, email, status FROM admins WHERE email=$1 LIMIT 1", [email]);
        const genericResponse = {
            success: true,
            message: "If this admin email exists, a password reset link will be sent.",
        };
        if (!adminResult.rows.length || adminResult.rows[0].status === "blocked") {
            return res.json(genericResponse);
        }
        const token = crypto_1.default.randomBytes(32).toString("hex");
        const tokenHash = hashResetToken(token);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
        await db_1.pool.query(`UPDATE admins
       SET reset_password_token_hash=$1,
           reset_password_expires_at=$2,
           reset_password_used_at=NULL
       WHERE id=$3`, [tokenHash, expiresAt, adminResult.rows[0].id]);
        const resetUrl = `${ADMIN_APP_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
        if (!(0, mail_service_1.isMailConfigured)()) {
            return res.json({
                ...genericResponse,
                mailConfigured: false,
                message: "Reset token created, but SMTP is not configured on backend.",
            });
        }
        await (0, mail_service_1.sendMail)({
            to: email,
            subject: "Reset your ExGold Admin password",
            text: `Reset your ExGold Admin password using this link: ${resetUrl}. This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes.`,
            html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
          <h2>Reset your ExGold Admin password</h2>
          <p>Use the button below to set a new password. This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes.</p>
          <p><a href="${resetUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 18px;text-decoration:none;border-radius:8px">Reset Password</a></p>
          <p>If the button does not work, open this link:</p>
          <p>${resetUrl}</p>
        </div>
      `,
        });
        return res.json({ ...genericResponse, mailConfigured: true });
    }
    catch (error) {
        console.error("Admin forgot password error:", error);
        return res.status(500).json({ success: false, message: "Failed to request password reset" });
    }
};
exports.forgotAdminPassword = forgotAdminPassword;
const adminMe = async (req, res) => {
    const user = req.user || {};
    return res.json({
        id: user.id,
        username: user.username || user.email,
        email: user.email,
        role: user.role || "admin",
    });
};
exports.adminMe = adminMe;
const resetAdminPassword = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const token = String(req.body.token || "").trim();
        const password = String(req.body.password || "");
        if (!email || !token || !password) {
            return res.status(400).json({ success: false, message: "Email, token and password are required" });
        }
        if (password.length < 8) {
            return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
        }
        const tokenHash = hashResetToken(token);
        const adminResult = await db_1.pool.query(`SELECT id
       FROM admins
       WHERE email=$1
         AND reset_password_token_hash=$2
         AND reset_password_used_at IS NULL
         AND reset_password_expires_at > NOW()
       LIMIT 1`, [email, tokenHash]);
        if (!adminResult.rows.length) {
            return res.status(400).json({ success: false, message: "Invalid or expired reset link" });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        await db_1.pool.query(`UPDATE admins
       SET password=$1,
           reset_password_used_at=NOW(),
           reset_password_token_hash=NULL,
           reset_password_expires_at=NULL
       WHERE id=$2`, [passwordHash, adminResult.rows[0].id]);
        return res.json({ success: true, message: "Password updated successfully" });
    }
    catch (error) {
        console.error("Admin reset password error:", error);
        return res.status(500).json({ success: false, message: "Failed to reset password" });
    }
};
exports.resetAdminPassword = resetAdminPassword;
