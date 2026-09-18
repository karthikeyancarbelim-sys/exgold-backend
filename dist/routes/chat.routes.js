"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const chat_controller_1 = require("../controllers/chat.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
router.get("/", auth_1.verifyFirebaseToken, chat_controller_1.getMyConversations);
router.post("/", auth_1.verifyFirebaseToken, chat_controller_1.createConversation);
router.get("/:id/messages", auth_1.verifyFirebaseToken, chat_controller_1.getConversationMessages);
router.post("/:id/messages", auth_1.verifyFirebaseToken, chat_controller_1.sendMessage);
exports.default = router;
