"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const users_controller_1 = require("../controllers/users.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
router.post("/register", auth_1.verifyFirebaseToken, users_controller_1.registerUser);
router.get("/profile", auth_1.verifyFirebaseToken, users_controller_1.getProfile);
exports.default = router;
