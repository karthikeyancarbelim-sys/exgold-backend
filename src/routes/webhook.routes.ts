// ===============================
// webhook.routes.ts
// ===============================
import express from "express";
import { razorpayWebhook } from "../controllers/webhook.controller";

const router = express.Router();

/* RAZORPAY WEBHOOK */
router.post("/razorpay", express.json(), razorpayWebhook);

export default router;