import express from "express";
import {
  getMyNotifications,
  markNotificationRead,
} from "../controllers/notification.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

router.get("/", verifyFirebaseToken, getMyNotifications);
router.patch("/:id/read", verifyFirebaseToken, markNotificationRead);

export default router;
