import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

import "./config/db";

import userRoutes from "./routes/users.routes";
import goldRoutes from "./routes/gold.routes";
import walletRoutes from "./routes/wallet.routes";
import paymentRoutes from "./routes/payment.routes";
import adminRoutes from "./routes/admin.routes";
import adsRoutes from "./routes/classifiedads.routes";
import subscriptionRoutes from "./routes/subscription.routes";
import webhookRoutes from "./routes/webhook.routes";
import referralRoutes from "./routes/referral.routes";
import kycRoutes from "./routes/kyc.routes";
import categoryRoutes from "./routes/category.routes";
import investmentRoutes from "./routes/investment.routes";
import augmontRoutes from "./routes/augmont.routes";
import notificationRoutes from "./routes/notification.routes";
import wishlistRoutes from "./routes/wishlist.routes";
import ticketRoutes from "./routes/ticket.routes";
import chatRoutes from "./routes/chat.routes";
import homeRoutes from "./routes/home.routes";
import withdrawalRoutes from "./routes/withdrawal.routes";
import appRoutes from "./routes/app.routes";

import { apiLimiter } from "./middleware/rateLimit.middleware";
import { errorHandler } from "./middleware/error.middleware";
import { startDigitalGoldSaleReconciliation } from "./services/digital-gold-sale-settlement.service";
import { startDigitalGoldBuyReconciliation } from "./services/digital-gold-settlement.service";

const app = express();

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

const isAllowedOrigin = (origin?: string) => !origin || allowedOrigins.includes(origin);

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

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/* ===============================
   WEBHOOK (RAW BODY FIRST)
   =============================== */
app.use(
  "/webhook",
  express.raw({ type: "*/*" }),
  webhookRoutes
);

/* ===============================
   JSON PARSER
   =============================== */
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "5mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_BODY_LIMIT || "5mb" }));

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

/* ===============================
   RATE LIMIT
   =============================== */
app.use(apiLimiter);

/* ===============================
   HEALTH CHECK
   =============================== */
app.get("/", (_req, res) => {
  res.send("ExGold backend running");
});

/* ===============================
   ROUTES (API STRUCTURE FIXED)
   =============================== */
app.use("/api/users", userRoutes);
app.use("/api/gold", goldRoutes);
app.use("/api/wallets", walletRoutes); // ✅ fixed
app.use("/api/payment", paymentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/referral", referralRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/investment", investmentRoutes);
app.use("/api/augmont", augmontRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/home", homeRoutes);
app.use("/api/withdrawal", withdrawalRoutes);
app.use("/api/app", appRoutes);

/* Flutter compatibility routes.
   The mobile app already calls these paths through ApiService.baseUrl. */
app.use("/users", userRoutes);
app.use("/gold", goldRoutes);
app.use("/wallets", walletRoutes);
app.use("/payment", paymentRoutes);
app.use("/ads", adsRoutes);
app.use("/subscription", subscriptionRoutes);
app.use("/referral", referralRoutes);
app.use("/kyc", kycRoutes);
app.use("/categories", categoryRoutes);
app.use("/investment", investmentRoutes);
app.use("/augmont", augmontRoutes);
app.use("/notifications", notificationRoutes);
app.use("/wishlist", wishlistRoutes);
app.use("/tickets", ticketRoutes);
app.use("/chats", chatRoutes);
app.use("/home", homeRoutes);
app.use("/withdrawal", withdrawalRoutes);
app.use("/app", appRoutes);

/* ===============================
   ERROR HANDLER
   =============================== */
app.use(errorHandler);

/* ===============================
   SERVER
   =============================== */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startDigitalGoldSaleReconciliation();
  startDigitalGoldBuyReconciliation();
});
