"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const notification_controller_1 = require("../controllers/notification.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
router.get("/", auth_1.verifyFirebaseToken, notification_controller_1.getMyNotifications);
router.patch("/:id/read", auth_1.verifyFirebaseToken, notification_controller_1.markNotificationRead);
exports.default = router;
