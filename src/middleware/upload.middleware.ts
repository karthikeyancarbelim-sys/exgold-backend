import fs from "fs";
import path from "path";
import multer from "multer";

const profileDir = path.join(process.cwd(), "uploads", "profiles");
fs.mkdirSync(profileDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, profileDir);
  },
  filename: (req: any, file, callback) => {
    const safeUid = String(req.user?.uid || "user").replace(/[^a-zA-Z0-9_-]/g, "");
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    callback(null, `${safeUid}-${Date.now()}${ext}`);
  },
});

export const profilePhotoUpload = multer({
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
