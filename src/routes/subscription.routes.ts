// ===============================
// subscription.routes.ts
// ===============================
import express from "express";
import {
  getMySubscription,
  getAllSubscriptions
} from "../controllers/subscription.controller";
import { verifyFirebaseToken } from "../middleware/auth";
import { verifyAdminJWT } from "../middleware/adminJwt";

const router = express.Router();

/* USER */
router.get("/me", verifyFirebaseToken, getMySubscription);

/* ADMIN */
router.get("/all", verifyAdminJWT, getAllSubscriptions);

export default router;