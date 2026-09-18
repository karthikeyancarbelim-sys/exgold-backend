import { Response } from "express";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";

const allowedItemTypes = new Set(["ad", "augmont_product"]);

const getUserId = async (uid: string) => {
  const result = await pool.query(
    "SELECT id FROM users WHERE firebase_uid=$1 LIMIT 1",
    [uid]
  );
  return result.rows[0]?.id as number | undefined;
};

const itemKeyFrom = (req: AuthRequest) =>
  String(req.params.itemKey || req.params.adId || "").trim();

const itemTypeFrom = (req: AuthRequest) =>
  String(
    req.body?.itemType ||
      req.body?.item_type ||
      req.body?.type ||
      req.query.itemType ||
      req.query.type ||
      "ad"
  )
    .trim()
    .toLowerCase();

export const getWishlist = async (req: AuthRequest, res: Response) => {
  try {
    const userId = await getUserId(req.user.uid);
    if (!userId) return res.status(404).json({ message: "User not found" });

    const result = await pool.query(
      `SELECT id,
              item_type AS "itemType",
              item_key AS "itemKey",
              title,
              image_url AS "imageUrl",
              metadata,
              created_at AS "createdAt"
       FROM wishlist_items
       WHERE user_id=$1
       ORDER BY created_at DESC`,
      [userId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("GET WISHLIST ERROR:", error);
    return res.status(500).json({ message: "Failed to fetch favourites" });
  }
};

export const addWishlist = async (req: AuthRequest, res: Response) => {
  try {
    const userId = await getUserId(req.user.uid);
    if (!userId) return res.status(404).json({ message: "User not found" });

    const itemKey = itemKeyFrom(req);
    const itemType = itemTypeFrom(req);
    if (!itemKey) return res.status(400).json({ message: "Item reference is required" });
    if (!allowedItemTypes.has(itemType)) {
      return res.status(400).json({ message: "Unsupported favourite type" });
    }

    const title = String(req.body?.title || "").trim();
    const imageUrl = String(req.body?.imageUrl || req.body?.image_url || "").trim();
    const metadata =
      req.body?.metadata && typeof req.body.metadata === "object"
        ? req.body.metadata
        : {};

    const result = await pool.query(
      `INSERT INTO wishlist_items
         (user_id, item_type, item_key, title, image_url, metadata)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, item_type, item_key)
       DO UPDATE SET
         title=EXCLUDED.title,
         image_url=EXCLUDED.image_url,
         metadata=EXCLUDED.metadata
       RETURNING id,
                 item_type AS "itemType",
                 item_key AS "itemKey",
                 title,
                 image_url AS "imageUrl",
                 metadata,
                 created_at AS "createdAt"`,
      [userId, itemType, itemKey, title, imageUrl, metadata]
    );
    return res.status(201).json({ success: true, item: result.rows[0] });
  } catch (error) {
    console.error("ADD WISHLIST ERROR:", error);
    return res.status(500).json({ message: "Failed to save favourite" });
  }
};

export const removeWishlist = async (req: AuthRequest, res: Response) => {
  try {
    const userId = await getUserId(req.user.uid);
    if (!userId) return res.status(404).json({ message: "User not found" });

    const itemKey = itemKeyFrom(req);
    const itemType = itemTypeFrom(req);
    if (!itemKey) return res.status(400).json({ message: "Item reference is required" });

    await pool.query(
      "DELETE FROM wishlist_items WHERE user_id=$1 AND item_type=$2 AND item_key=$3",
      [userId, itemType, itemKey]
    );
    return res.json({ success: true });
  } catch (error) {
    console.error("REMOVE WISHLIST ERROR:", error);
    return res.status(500).json({ message: "Failed to remove favourite" });
  }
};
