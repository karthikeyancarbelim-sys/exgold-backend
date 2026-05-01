"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ===============================
// subscription.routes.ts
// ===============================
const express_1 = __importDefault(require("express"));
const subscription_controller_1 = require("../controllers/subscription.controller");
const auth_1 = require("../middleware/auth");
const adminJwt_1 = require("../middleware/adminJwt");
const router = express_1.default.Router();
/* USER */
router.get("/me", auth_1.verifyFirebaseToken, subscription_controller_1.getMySubscription);
/* ADMIN */
router.get("/all", adminJwt_1.verifyAdminJWT, subscription_controller_1.getAllSubscriptions);
exports.default = router;
