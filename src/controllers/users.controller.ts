import { Response } from "express";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";
import { ensureAugmontInvestmentUser } from "../services/investment-kyc.service";
import {
  augmontDeleteUserAddress,
  augmontSaveUserAddress,
  extractDeep,
} from "../services/augmont.service";

const toCamelProfile = (user: any) => ({
  id: user.id,
  uid: user.firebase_uid,
  name: user.name || "",
  phone: user.phone || "",
  email: user.email || "",
  dob: user.dob || "",
  gender: user.gender || "",
  city: user.city || "",
  role: user.role || "buyer",
  profileCompleted: Boolean(user.profile_completed),
  walletBalance: Number(user.balance) || 0,
  goldBalance: Number(user.gold_balance) || 0,
  photoUrl: user.photo_url || "",
  shopLat: user.shop_lat === null || user.shop_lat === undefined ? null : Number(user.shop_lat),
  shopLng: user.shop_lng === null || user.shop_lng === undefined ? null : Number(user.shop_lng),
  shopAddress: user.shop_address || "",
  subscriptionActive: Boolean(user.subscription_active),
  subscriptionPlan: user.subscription_plan || "",
  subscriptionStart: user.subscription_start,
  subscriptionEnd: user.subscription_end,
  trialUsed: Boolean(user.trial_used),
  kycStatus: user.kyc_status || "none",
  adsUsed: Number(user.ads_used) || 0,
  adsLimit: Number(user.ads_limit) || 0,
  createdAt: user.created_at,
});

const getUserColumns = async () => {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'users'`
  );

  return new Set(result.rows.map((row) => row.column_name));
};

const toCamelAddress = (row: any) => ({
  id: row.id,
  userId: row.user_id,
  augmontAddressId: row.augmont_address_id || "",
  augmontSynced: Boolean(row.augmont_address_id),
  label: row.label || "Home",
  fullName: row.full_name || "",
  mobile: row.mobile || "",
  line1: row.line1 || "",
  line2: row.line2 || "",
  city: row.city || "",
  state: row.state || "",
  pincode: row.pincode || "",
  country: row.country || "India",
  isDefault: Boolean(row.is_default),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getCurrentUserId = async (uid: string) => {
  const result = await pool.query("SELECT id FROM users WHERE firebase_uid=$1", [uid]);
  return result.rows[0]?.id as number | undefined;
};

const normalizeAddressInput = (body: any) => {
  const fullName = String(body.fullName ?? body.name ?? "").trim();
  const mobile = String(body.mobile ?? body.mobileNumber ?? body.phone ?? "").trim();
  const line1 = String(body.line1 ?? body.address ?? body.addressLine1 ?? "").trim();
  const line2 = String(body.line2 ?? body.addressLine2 ?? "").trim();
  const city = String(body.city ?? "").trim();
  const state = String(body.state ?? "").trim();
  const pincode = String(body.pincode ?? body.pinCode ?? body.zip ?? "").trim();
  const country = String(body.country ?? "India").trim() || "India";

  return {
    label: String(body.label ?? "Home").trim() || "Home",
    fullName,
    mobile,
    line1,
    line2,
    city,
    state,
    pincode,
    country,
  };
};

const validateAddress = (address: ReturnType<typeof normalizeAddressInput>) => {
  const missing = ["fullName", "mobile", "line1", "city", "state", "pincode"]
    .filter((key) => !(address as any)[key]);
  return missing;
};

const augmontAddressBody = (address: ReturnType<typeof normalizeAddressInput>) => ({
  name: address.fullName,
  fullName: address.fullName,
  mobile: address.mobile,
  mobileNumber: address.mobile,
  phone: address.mobile,
  address: address.line1,
  line1: address.line1,
  line2: address.line2,
  city: address.city,
  state: address.state,
  pincode: address.pincode,
  pinCode: address.pincode,
  country: address.country,
});

const extractAddressId = (payload: any) => {
  const value = extractDeep(payload, [
    "userAddressId",
    "user_address_id",
    "addressId",
    "address_id",
    "id",
  ]);
  return value === undefined || value === null ? "" : String(value);
};

const safeSyncAddressToAugmont = async (
  uniqueId: string,
  address: ReturnType<typeof normalizeAddressInput>
) => {
  try {
    await ensureAugmontInvestmentUser(uniqueId, address);
    const providerPayload = await augmontSaveUserAddress(uniqueId, augmontAddressBody(address));
    return {
      providerPayload,
      augmontAddressId: extractAddressId(providerPayload),
    };
  } catch (error: any) {
    return {
      providerPayload: {
        syncStatus: "failed",
        message: error?.message || "Augmont address sync failed",
      },
      augmontAddressId: "",
    };
  }
};

/* ===============================
   GET PROFILE
   =============================== */
export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;

    const result = await pool.query(
      `SELECT u.*, w.balance
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.firebase_uid = $1`,
      [uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = result.rows[0];

    return res.json(toCamelProfile(user));

  } catch (error) {
    console.error("GET PROFILE ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};


/* ===============================
   REGISTER USER + CREATE WALLET
   =============================== */
export const registerUser = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const uid = req.user.uid;

    // 🔥 SAFE INPUT HANDLING
    let { name, phone } = req.body;

    name = name?.toString().trim() || "";
    phone = phone?.toString().trim() || "";

    await client.query("BEGIN");

    // Check existing user
    const existingUser = await client.query(
      `SELECT u.*, w.balance
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.firebase_uid = $1`,
      [uid]
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];

      await client.query("COMMIT");

      return res.json(toCamelProfile(user));
    }

    // Create new user
    const newUser = await client.query(
      `INSERT INTO users (firebase_uid, name, phone)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [uid, name, phone]
    );

    const userId = newUser.rows[0].id;

    // Create wallet
    await client.query(
      `INSERT INTO wallets (user_id, balance)
       VALUES ($1, 0)`,
      [userId]
    );

    await client.query("COMMIT");

    return res.json(toCamelProfile({ ...newUser.rows[0], balance: 0 }));

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("REGISTER USER ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

/* ===============================
   UPDATE PROFILE
   =============================== */
export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;
    const columns = await getUserColumns();
    const allowedFields: Record<string, string> = {
      name: "name",
      phone: "phone",
      email: "email",
      dob: "dob",
      gender: "gender",
      city: "city",
      shopLat: "shop_lat",
      shopLng: "shop_lng",
      shopAddress: "shop_address",
      profileCompleted: "profile_completed",
    };

    const updates: string[] = [];
    const values: any[] = [];

    Object.entries(allowedFields).forEach(([bodyKey, column]) => {
      if (!columns.has(column) || req.body[bodyKey] === undefined) return;

      values.push(req.body[bodyKey]);
      updates.push(`${column} = $${values.length}`);
    });

    if (updates.length === 0) {
      return getProfile(req, res);
    }

    values.push(uid);

    const result = await pool.query(
      `UPDATE users
       SET ${updates.join(", ")}
       WHERE firebase_uid = $${values.length}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    await ensureAugmontInvestmentUser(uid).catch(() => null);
    return getProfile(req, res);
  } catch (error) {
    console.error("UPDATE PROFILE ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ===============================
   UPLOAD PROFILE PHOTO
   =============================== */
export const uploadProfilePhoto = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;
    const file = (req as any).file;

    if (!file) {
      return res.status(400).json({ message: "Profile photo is required" });
    }

    const publicApiUrl =
      process.env.PUBLIC_API_URL ||
      `${req.protocol}://${req.get("host")}`;
    const photoUrl = `${publicApiUrl.replace(/\/$/, "")}/uploads/profiles/${file.filename}`;

    const result = await pool.query(
      `UPDATE users
       SET photo_url=$1
       WHERE firebase_uid=$2
       RETURNING *`,
      [photoUrl, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      success: true,
      photoUrl,
      user: toCamelProfile(result.rows[0]),
    });
  } catch (error) {
    console.error("UPLOAD PROFILE PHOTO ERROR:", error);
    return res.status(500).json({ message: "Failed to upload profile photo" });
  }
};

/* ===============================
   DELIVERY ADDRESSES
   =============================== */
export const getAddresses = async (req: AuthRequest, res: Response) => {
  try {
    const userId = await getCurrentUserId(req.user.uid);
    if (!userId) return res.status(404).json({ message: "User not found" });

    const result = await pool.query(
      `SELECT *
       FROM user_addresses
       WHERE user_id=$1
       ORDER BY is_default DESC, updated_at DESC, id DESC`,
      [userId]
    );

    return res.json(result.rows.map(toCamelAddress));
  } catch (error) {
    console.error("GET ADDRESSES ERROR:", error);
    return res.status(500).json({ message: "Failed to load addresses" });
  }
};

export const createAddress = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const uid = req.user.uid;
    const userId = await getCurrentUserId(uid);
    if (!userId) return res.status(404).json({ message: "User not found" });

    const address = normalizeAddressInput(req.body);
    const missing = validateAddress(address);
    if (missing.length > 0) {
      return res.status(400).json({
        message: `Missing address fields: ${missing.join(", ")}`,
      });
    }

    const { providerPayload, augmontAddressId } = await safeSyncAddressToAugmont(uid, address);

    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT COUNT(*)::int AS count FROM user_addresses WHERE user_id=$1",
      [userId]
    );
    const makeDefault = Boolean(req.body.isDefault) || Number(existing.rows[0]?.count || 0) === 0;

    if (makeDefault) {
      await client.query("UPDATE user_addresses SET is_default=false WHERE user_id=$1", [userId]);
    }

    const result = await client.query(
      `INSERT INTO user_addresses
       (user_id, augmont_address_id, label, full_name, mobile, line1, line2, city, state,
        pincode, country, is_default, provider_payload, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       RETURNING *`,
      [
        userId,
        augmontAddressId,
        address.label,
        address.fullName,
        address.mobile,
        address.line1,
        address.line2,
        address.city,
        address.state,
        address.pincode,
        address.country,
        makeDefault,
        providerPayload,
      ]
    );

    await client.query("COMMIT");
    return res.status(201).json(toCamelAddress(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("CREATE ADDRESS ERROR:", error);
    return res.status(500).json({ message: "Failed to save delivery address" });
  } finally {
    client.release();
  }
};

export const updateAddress = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const uid = req.user.uid;
    const userId = await getCurrentUserId(uid);
    if (!userId) return res.status(404).json({ message: "User not found" });

    const existing = await pool.query(
      "SELECT * FROM user_addresses WHERE id=$1 AND user_id=$2",
      [req.params.id, userId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: "Address not found" });
    }

    const address = normalizeAddressInput(req.body);
    const missing = validateAddress(address);
    if (missing.length > 0) {
      return res.status(400).json({
        message: `Missing address fields: ${missing.join(", ")}`,
      });
    }

    const { providerPayload, augmontAddressId } = await safeSyncAddressToAugmont(uid, address);

    if (augmontAddressId && existing.rows[0].augmont_address_id) {
      await augmontDeleteUserAddress(uid, String(existing.rows[0].augmont_address_id)).catch(() => null);
    }

    await client.query("BEGIN");

    if (req.body.isDefault === true) {
      await client.query("UPDATE user_addresses SET is_default=false WHERE user_id=$1", [userId]);
    }

    const result = await client.query(
      `UPDATE user_addresses
       SET augmont_address_id=CASE WHEN $1::text <> '' THEN $1 ELSE augmont_address_id END,
           label=$2,
           full_name=$3,
           mobile=$4,
           line1=$5,
           line2=$6,
           city=$7,
           state=$8,
           pincode=$9,
           country=$10,
           is_default=CASE WHEN $11::boolean THEN true ELSE is_default END,
           provider_payload=$12,
           updated_at=NOW()
       WHERE id=$13 AND user_id=$14
       RETURNING *`,
      [
        augmontAddressId,
        address.label,
        address.fullName,
        address.mobile,
        address.line1,
        address.line2,
        address.city,
        address.state,
        address.pincode,
        address.country,
        req.body.isDefault === true,
        providerPayload,
        req.params.id,
        userId,
      ]
    );

    await client.query("COMMIT");
    return res.json(toCamelAddress(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("UPDATE ADDRESS ERROR:", error);
    return res.status(500).json({ message: "Failed to update delivery address" });
  } finally {
    client.release();
  }
};

export const deleteAddress = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const uid = req.user.uid;
    const userId = await getCurrentUserId(uid);
    if (!userId) return res.status(404).json({ message: "User not found" });

    const existing = await pool.query(
      "SELECT * FROM user_addresses WHERE id=$1 AND user_id=$2",
      [req.params.id, userId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: "Address not found" });
    }

    if (existing.rows[0].augmont_address_id) {
      await augmontDeleteUserAddress(uid, String(existing.rows[0].augmont_address_id)).catch(() => null);
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM user_addresses WHERE id=$1 AND user_id=$2", [req.params.id, userId]);

    if (existing.rows[0].is_default) {
      await client.query(
        `UPDATE user_addresses
         SET is_default=true, updated_at=NOW()
         WHERE id = (
           SELECT id FROM user_addresses
           WHERE user_id=$1
           ORDER BY updated_at DESC, id DESC
           LIMIT 1
         )`,
        [userId]
      );
    }

    await client.query("COMMIT");
    return res.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("DELETE ADDRESS ERROR:", error);
    return res.status(500).json({ message: "Failed to delete delivery address" });
  } finally {
    client.release();
  }
};

export const setDefaultAddress = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const userId = await getCurrentUserId(req.user.uid);
    if (!userId) return res.status(404).json({ message: "User not found" });

    await client.query("BEGIN");
    await client.query("UPDATE user_addresses SET is_default=false WHERE user_id=$1", [userId]);
    const result = await client.query(
      `UPDATE user_addresses
       SET is_default=true, updated_at=NOW()
       WHERE id=$1 AND user_id=$2
       RETURNING *`,
      [req.params.id, userId]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Address not found" });
    }

    await client.query("COMMIT");
    return res.json(toCamelAddress(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("SET DEFAULT ADDRESS ERROR:", error);
    return res.status(500).json({ message: "Failed to set default address" });
  } finally {
    client.release();
  }
};

/* ===============================
   DEACTIVATE PROFILE
   =============================== */
export const deactivateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;
    const columns = await getUserColumns();

    if (columns.has("is_deleted")) {
      await pool.query(
        "UPDATE users SET is_deleted=true WHERE firebase_uid=$1",
        [uid]
      );
    } else if (columns.has("is_blocked")) {
      await pool.query(
        "UPDATE users SET is_blocked=true WHERE firebase_uid=$1",
        [uid]
      );
    } else {
      await pool.query("DELETE FROM users WHERE firebase_uid=$1", [uid]);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("DEACTIVATE PROFILE ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
