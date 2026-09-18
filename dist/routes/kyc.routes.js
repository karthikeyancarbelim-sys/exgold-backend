"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const kyc_controller_1 = require("../controllers/kyc.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
router.post("/create-session", auth_1.verifyFirebaseToken, kyc_controller_1.createKycSession);
router.post("/pan/verify", auth_1.verifyFirebaseToken, kyc_controller_1.verifyPan);
router.post("/start", auth_1.verifyFirebaseToken, kyc_controller_1.startKyc);
router.post("/start/:step", auth_1.verifyFirebaseToken, kyc_controller_1.startKyc);
router.get("/me", auth_1.verifyFirebaseToken, kyc_controller_1.getMyKyc);
router.post("/kycaid/callback", kyc_controller_1.kycaidCallback);
router.post("/nerotix/callback", kyc_controller_1.nerotixCallback);
exports.default = router;
