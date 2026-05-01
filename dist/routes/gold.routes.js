"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const gold_controller_1 = require("../controllers/gold.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
// Public
router.get("/rates", gold_controller_1.getGoldRates);
// Admin (protected)
router.post("/update-rate", auth_1.verifyFirebaseToken, gold_controller_1.updateGoldRates);
exports.default = router;
