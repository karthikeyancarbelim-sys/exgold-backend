import express from "express";
import cors from "cors";
import dotenv from "dotenv";

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

import { apiLimiter } from "./middleware/rateLimit.middleware";
import { errorHandler } from "./middleware/error.middleware";

const app = express();

/* ===============================
   CORS
   =============================== */
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
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
app.use(express.json());

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
   ROUTES
   =============================== */
app.use("/users", userRoutes);
app.use("/gold", goldRoutes);
app.use("/wallet", walletRoutes);
app.use("/payment", paymentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/ads", adsRoutes);
app.use("/subscription", subscriptionRoutes);
app.use("/referral", referralRoutes);
app.use("/kyc", kycRoutes);

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
});