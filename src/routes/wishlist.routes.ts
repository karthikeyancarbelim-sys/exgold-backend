import express from "express";
import {
  addWishlist,
  getWishlist,
  removeWishlist,
} from "../controllers/wishlist.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

router.get("/", verifyFirebaseToken, getWishlist);
router.post("/:itemKey", verifyFirebaseToken, addWishlist);
router.delete("/:itemKey", verifyFirebaseToken, removeWishlist);

export default router;
