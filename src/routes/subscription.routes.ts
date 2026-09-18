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
import { verifyAdmin } from "../middleware/admin";

const router = express.Router();

/* USER */
router.get("/me", verifyFirebaseToken, getMySubscription);

/* ADMIN */
router.get("/all", verifyAdminJWT, verifyAdmin, getAllSubscriptions);

export default router;
