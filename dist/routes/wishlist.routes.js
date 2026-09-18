"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const wishlist_controller_1 = require("../controllers/wishlist.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
router.get("/", auth_1.verifyFirebaseToken, wishlist_controller_1.getWishlist);
router.post("/:itemKey", auth_1.verifyFirebaseToken, wishlist_controller_1.addWishlist);
router.delete("/:itemKey", auth_1.verifyFirebaseToken, wishlist_controller_1.removeWishlist);
exports.default = router;
