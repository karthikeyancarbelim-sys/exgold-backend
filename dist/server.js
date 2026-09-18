"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
require("./config/db");
const users_routes_1 = __importDefault(require("./routes/users.routes"));
const gold_routes_1 = __importDefault(require("./routes/gold.routes"));
const wallet_routes_1 = __importDefault(require("./routes/wallet.routes"));
const payment_routes_1 = __importDefault(require("./routes/payment.routes"));
const admin_routes_1 = __importDefault(require("./routes/admin.routes"));
const classifiedads_routes_1 = __importDefault(require("./routes/classifiedads.routes"));
const subscription_routes_1 = __importDefault(require("./routes/subscription.routes"));
const webhook_routes_1 = __importDefault(require("./routes/webhook.routes"));
const referral_routes_1 = __importDefault(require("./routes/referral.routes"));
const kyc_routes_1 = __importDefault(require("./routes/kyc.routes"));
const category_routes_1 = __importDefault(require("./routes/category.routes"));
const investment_routes_1 = __importDefault(require("./routes/investment.routes"));
const augmont_routes_1 = __importDefault(require("./routes/augmont.routes"));
const notification_routes_1 = __importDefault(require("./routes/notification.routes"));
const wishlist_routes_1 = __importDefault(require("./routes/wishlist.routes"));
const ticket_routes_1 = __importDefault(require("./routes/ticket.routes"));
const chat_routes_1 = __importDefault(require("./routes/chat.routes"));
const home_routes_1 = __importDefault(require("./routes/home.routes"));
const withdrawal_routes_1 = __importDefault(require("./routes/withdrawal.routes"));
const app_routes_1 = __importDefault(require("./routes/app.routes"));
const rateLimit_middleware_1 = require("./middleware/rateLimit.middleware");
const error_middleware_1 = require("./middleware/error.middleware");
const digital_gold_sale_settlement_service_1 = require("./services/digital-gold-sale-settlement.service");
const digital_gold_settlement_service_1 = require("./services/digital-gold-settlement.service");
const app = (0, express_1.default)();
/* Hostinger/hCDN terminates HTTPS and forwards requests to Node.
   Trust the nearest proxy so rate limiting can read the real client IP. */
app.set("trust proxy", 1);
/* ===============================
   CORS
   =============================== */
const configuredOrigins = (process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
const productionOrigins = [
    "https://app.exgold.in",
    "https://api.exgold.in",
];
const developmentOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
];
const allowedOrigins = [
    ...configuredOrigins,
    ...productionOrigins,
    ...(process.env.NODE_ENV === "production" ? [] : developmentOrigins),
];
const isAllowedOrigin = (origin) => !origin || allowedOrigins.includes(origin);
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (isAllowedOrigin(origin)) {
        if (origin) {
            res.header("Access-Control-Allow-Origin", origin);
            res.header("Vary", "Origin");
        }
        res.header("Access-Control-Allow-Credentials", "true");
        res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }
    return next();
});
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
            return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
}));
/* ===============================
   WEBHOOK (RAW BODY FIRST)
   =============================== */
app.use("/webhook", express_1.default.raw({ type: "*/*" }), webhook_routes_1.default);
/* ===============================
   JSON PARSER
   =============================== */
app.use(express_1.default.json({ limit: process.env.JSON_BODY_LIMIT || "5mb" }));
app.use(express_1.default.urlencoded({ extended: true, limit: process.env.URLENCODED_BODY_LIMIT || "5mb" }));
app.use("/uploads", express_1.default.static(path_1.default.join(process.cwd(), "uploads")));
/* ===============================
   RATE LIMIT
   =============================== */
app.use(rateLimit_middleware_1.apiLimiter);
/* ===============================
   HEALTH CHECK
   =============================== */
app.get("/", (_req, res) => {
    res.send("ExGold backend running");
});
/* ===============================
   ROUTES (API STRUCTURE FIXED)
   =============================== */
app.use("/api/users", users_routes_1.default);
app.use("/api/gold", gold_routes_1.default);
app.use("/api/wallets", wallet_routes_1.default); // ✅ fixed
app.use("/api/payment", payment_routes_1.default);
app.use("/api/admin", admin_routes_1.default);
app.use("/api/ads", classifiedads_routes_1.default);
app.use("/api/subscription", subscription_routes_1.default);
app.use("/api/referral", referral_routes_1.default);
app.use("/api/kyc", kyc_routes_1.default);
app.use("/api/categories", category_routes_1.default);
app.use("/api/investment", investment_routes_1.default);
app.use("/api/augmont", augmont_routes_1.default);
app.use("/api/notifications", notification_routes_1.default);
app.use("/api/wishlist", wishlist_routes_1.default);
app.use("/api/tickets", ticket_routes_1.default);
app.use("/api/chats", chat_routes_1.default);
app.use("/api/home", home_routes_1.default);
app.use("/api/withdrawal", withdrawal_routes_1.default);
app.use("/api/app", app_routes_1.default);
/* Flutter compatibility routes.
   The mobile app already calls these paths through ApiService.baseUrl. */
app.use("/users", users_routes_1.default);
app.use("/gold", gold_routes_1.default);
app.use("/wallets", wallet_routes_1.default);
app.use("/payment", payment_routes_1.default);
app.use("/ads", classifiedads_routes_1.default);
app.use("/subscription", subscription_routes_1.default);
app.use("/referral", referral_routes_1.default);
app.use("/kyc", kyc_routes_1.default);
app.use("/categories", category_routes_1.default);
app.use("/investment", investment_routes_1.default);
app.use("/augmont", augmont_routes_1.default);
app.use("/notifications", notification_routes_1.default);
app.use("/wishlist", wishlist_routes_1.default);
app.use("/tickets", ticket_routes_1.default);
app.use("/chats", chat_routes_1.default);
app.use("/home", home_routes_1.default);
app.use("/withdrawal", withdrawal_routes_1.default);
app.use("/app", app_routes_1.default);
/* ===============================
   ERROR HANDLER
   =============================== */
app.use(error_middleware_1.errorHandler);
/* ===============================
   SERVER
   =============================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    (0, digital_gold_sale_settlement_service_1.startDigitalGoldSaleReconciliation)();
    (0, digital_gold_settlement_service_1.startDigitalGoldBuyReconciliation)();
});
