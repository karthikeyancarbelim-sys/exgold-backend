import express from "express";
import {
  createAddress,
  deleteAddress,
  deactivateProfile,
  getAddresses,
  getProfile,
  registerUser,
  setDefaultAddress,
  updateAddress,
  updateProfile,
  uploadProfilePhoto
} from "../controllers/users.controller";
import { verifyFirebaseToken } from "../middleware/auth";
import { profilePhotoUpload } from "../middleware/upload.middleware";

const router = express.Router();

router.post("/register", verifyFirebaseToken, registerUser);
router.get("/profile", verifyFirebaseToken, getProfile);
router.patch("/profile", verifyFirebaseToken, updateProfile);
router.post("/profile/photo", verifyFirebaseToken, profilePhotoUpload.single("photo"), uploadProfilePhoto);
router.delete("/profile", verifyFirebaseToken, deactivateProfile);
router.get("/addresses", verifyFirebaseToken, getAddresses);
router.post("/addresses", verifyFirebaseToken, createAddress);
router.patch("/addresses/:id", verifyFirebaseToken, updateAddress);
router.patch("/addresses/:id/default", verifyFirebaseToken, setDefaultAddress);
router.delete("/addresses/:id", verifyFirebaseToken, deleteAddress);

export default router;
