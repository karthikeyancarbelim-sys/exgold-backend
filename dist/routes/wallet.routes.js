"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const wallet_controller_1 = require("../controllers/wallet.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
/* GET WALLET BALANCE */
router.get("/balance", auth_1.verifyFirebaseToken, wallet_controller_1.getWallet);
/* WALLET TRANSACTION HISTORY */
router.get("/history", auth_1.verifyFirebaseToken, wallet_controller_1.getWalletHistory);
exports.default = router;
