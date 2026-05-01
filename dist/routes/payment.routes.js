"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const payment_controller_1 = require("../controllers/payment.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
/* CREATE SUBSCRIPTION */
router.post("/create-subscription", auth_1.verifyFirebaseToken, payment_controller_1.createSubscription);
/* VERIFY SUBSCRIPTION */
router.post("/verify-subscription", auth_1.verifyFirebaseToken, payment_controller_1.verifySubscription);
exports.default = router;
