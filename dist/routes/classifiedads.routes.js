"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ===============================
// classifiedads.routes.ts
// ===============================
const express_1 = __importDefault(require("express"));
const classifiedads_controller_1 = require("../controllers/classifiedads.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
/* USER */
router.get("/my", auth_1.verifyFirebaseToken, classifiedads_controller_1.getMyAds);
router.post("/", auth_1.verifyFirebaseToken, classifiedads_controller_1.createAd);
router.put("/:id", auth_1.verifyFirebaseToken, classifiedads_controller_1.updateAd);
router.patch("/:id", auth_1.verifyFirebaseToken, classifiedads_controller_1.updateAd);
router.patch("/:id/status", auth_1.verifyFirebaseToken, classifiedads_controller_1.updateAdStatus);
router.post("/:id/feature", auth_1.verifyFirebaseToken, classifiedads_controller_1.activateFeaturedAd);
router.delete("/:id", auth_1.verifyFirebaseToken, classifiedads_controller_1.deleteAd);
/* PUBLIC */
router.get("/categories", classifiedads_controller_1.getCategories);
router.get("/", classifiedads_controller_1.getAds);
router.get("/:id", classifiedads_controller_1.getAdById);
exports.default = router;
