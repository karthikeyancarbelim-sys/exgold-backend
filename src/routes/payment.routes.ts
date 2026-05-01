import express from "express";
import {
  createSubscription,
  verifySubscription
} from "../controllers/payment.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

/* CREATE SUBSCRIPTION */
router.post("/create-subscription", verifyFirebaseToken, createSubscription);

/* VERIFY SUBSCRIPTION */
router.post("/verify-subscription", verifyFirebaseToken, verifySubscription);

export default router;