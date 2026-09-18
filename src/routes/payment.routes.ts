import express from "express";
import {
  createOrder,
  createDigitalGoldCheckout,
  createPhysicalProductCheckout,
  verifyCheckoutPayment,
  verifyPayment,
  createSubscription,
  verifySubscription
} from "../controllers/payment.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

/* ===============================
   WALLET PAYMENT
   =============================== */
router.post("/create-order", verifyFirebaseToken, createOrder);
router.post("/verify", verifyFirebaseToken, verifyPayment);

router.post("/checkout/digital-gold", verifyFirebaseToken, createDigitalGoldCheckout);
router.post("/checkout/physical-products", verifyFirebaseToken, createPhysicalProductCheckout);
router.post("/checkout/verify", verifyFirebaseToken, verifyCheckoutPayment);

/* ===============================
   SUBSCRIPTION PAYMENT
   =============================== */
router.post("/create-subscription", verifyFirebaseToken, createSubscription);
router.post("/verify-subscription", verifyFirebaseToken, verifySubscription);

export default router;
