"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.profilePhotoUpload = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const multer_1 = __importDefault(require("multer"));
const profileDir = path_1.default.join(process.cwd(), "uploads", "profiles");
fs_1.default.mkdirSync(profileDir, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, callback) => {
        callback(null, profileDir);
    },
    filename: (req, file, callback) => {
        const safeUid = String(req.user?.uid || "user").replace(/[^a-zA-Z0-9_-]/g, "");
        const ext = path_1.default.extname(file.originalname || "").toLowerCase() || ".jpg";
        callback(null, `${safeUid}-${Date.now()}${ext}`);
    },
});
exports.profilePhotoUpload = (0, multer_1.default)({
    storage,
    fileFilter: (_req, file, callback) => {
        if (!file.mimetype.startsWith("image/")) {
            callback(new Error("Only image uploads are allowed"));
            return;
        }
        callback(null, true);
    },
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
});
