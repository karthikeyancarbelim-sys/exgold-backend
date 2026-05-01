import express from "express";
import { registerUser, getProfile } from "../controllers/users.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

router.post("/register", verifyFirebaseToken, registerUser);
router.get("/profile", verifyFirebaseToken, getProfile);

export default router;