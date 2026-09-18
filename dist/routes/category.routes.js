"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const category_controller_1 = require("../controllers/category.controller");
const adminJwt_1 = require("../middleware/adminJwt");
const admin_1 = require("../middleware/admin");
const rateLimit_middleware_1 = require("../middleware/rateLimit.middleware");
const router = express_1.default.Router();
router.get("/", category_controller_1.getJewelleryCategories);
router.get("/admin/all", rateLimit_middleware_1.apiLimiter, adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, category_controller_1.getAllCategories);
router.post("/admin", rateLimit_middleware_1.apiLimiter, adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, category_controller_1.createCategory);
router.put("/admin/:id", rateLimit_middleware_1.apiLimiter, adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, category_controller_1.updateCategory);
router.delete("/admin/:id", rateLimit_middleware_1.apiLimiter, adminJwt_1.verifyAdminJWT, admin_1.verifyAdmin, category_controller_1.deleteCategory);
exports.default = router;
