// ===============================
// webhook.routes.ts
// ===============================
import express from "express";
import { razorpayWebhook } from "../controllers/webhook.controller";

const router = express.Router();

/* ===============================
   RAZORPAY WEBHOOK (RAW BODY)
   =============================== */
router.post(
  "/razorpay",
  express.raw({ type: "*/*" }), // ✅ MUST be raw
  razorpayWebhook
);

export default router;