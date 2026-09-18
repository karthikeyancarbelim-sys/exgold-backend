import express from "express";
import {
  createConversation,
  getConversationMessages,
  getMyConversations,
  sendMessage,
} from "../controllers/chat.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

router.get("/", verifyFirebaseToken, getMyConversations);
router.post("/", verifyFirebaseToken, createConversation);
router.get("/:id/messages", verifyFirebaseToken, getConversationMessages);
router.post("/:id/messages", verifyFirebaseToken, sendMessage);

export default router;
