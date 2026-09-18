// ===============================
// classifiedads.controller.ts
// ===============================
import { Request, Response } from "express";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";
import admin from "../config/firebase";

const parsePurity = (value: unknown) => {
  const parsed = Number(String(value || "22K").replace(/k/i, ""));
  return [18, 22, 24].includes(parsed) ? parsed : 22;
};

const karatExpr = (alias: string) =>
  `NULLIF(regexp_replace(${alias}.karat::text, '[^0-9]', '', 'g'), '')::int`;

const purityExpr = (alias: string) =>
  `NULLIF(regexp_replace(${alias}.purity::text, '[^0-9]', '', 'g'), '')::int`;

const rowToFlutterAd = (row: any) => {
  const weight = Number(row.grams || row.weight || 0);
  const makingCharge = Number(row.making_charges || row.makingCharge || 0);
  const wastage = Number(row.wastage || 0);
  const condition = row.condition || "New";
  const isNewGold = String(condition).toLowerCase() === "new";
  const liveRate = Number(row.current_gold_rate || row.gold_rate_snapshot || 0);
  const basePrice = liveRate * weight;
  const livePrice = isNewGold && basePrice > 0
    ? Math.round(basePrice + basePrice * (wastage / 100) + makingCharge)
    : Number(row.price || 0);

  return {
    id: String(row.id),
    adId: String(row.id),
    title: row.title || "",
    sellerId: row.firebase_uid || row.seller_id || "",
    sellerName: ["internal", "team", "staff", "admin", "superadmin"].includes(String(row.seller_role || row.role || "").toLowerCase())
      ? "ExGold"
      : row.seller_name || row.name || "EX Gold Seller",
    sellerRole: row.seller_role || row.role || "",
    shopLat: row.shop_lat === null || row.shop_lat === undefined ? null : Number(row.shop_lat),
    shopLng: row.shop_lng === null || row.shop_lng === undefined ? null : Number(row.shop_lng),
    shopAddress: row.shop_address || "",
    city: row.city || "",
    weight,
    purity: `${parsePurity(row.purity)}K`,
    makingCharge,
    wastage,
    condition,
    productType: isNewGold ? "new" : "old",
    description: row.description || "",
    images: Array.isArray(row.images) ? row.images : [],
    status: row.status || "active",
    isFeatured: Boolean(row.is_featured) && (!row.featured_until || new Date(row.featured_until) > new Date()),
    featuredUntil: row.featured_until || null,
    price: livePrice,
    categoryId: row.category_id || row.categoryId || "",
    metal: row.metal || "Gold",
    createdAt: row.created_at || row.createdAt || null,
  };
};

const hasActiveSubscription = (user: any) => {
  if (!user.subscription_active) return false;
  if (!user.subscription_end) return true;
  return new Date(user.subscription_end) > new Date();
};

const isInternalTeam = (role: string) =>
  ["internal", "team", "staff", "admin", "superadmin"].includes(role);

/* ===============================
   CREATE AD
   =============================== */
export const createAd = async (req: AuthRequest, res: Response) => {
  try {
    const {
      title,
      description,
      grams,
      weight,
      purity,
      wastage,
      making_charges,
      makingCharge,
      city,
      price,
      categoryId,
      category_id,
      metal,
      condition,
      images,
      sellerName,
      status,
    } = req.body;

    const uid = req.user.uid;
    const adWeight = Number(grams ?? weight);
    const adPurity = parsePurity(purity);
    const adMakingCharges = Number(making_charges ?? makingCharge ?? 0);

    if (!adWeight || adWeight <= 0) {
      return res.status(400).json({ error: "Invalid weight" });
    }

    const userResult = await pool.query(
      `SELECT id, name, city, role, profile_completed, subscription_active, subscription_end, trial_used,
              shop_lat, shop_lng, shop_address,
              COALESCE(ads_used, 0) AS ads_used,
              COALESCE(ads_limit, 0) AS ads_limit
       FROM users WHERE firebase_uid=$1`,
      [uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];
    const role = String(user.role || "buyer").toLowerCase();
    const subscriptionActive = hasActiveSubscription(user);

    const internalTeam = isInternalTeam(role);

    if (role === "buyer") {
      return res.status(403).json({ error: "Buyer role cannot post ads" });
    }

    if (!internalTeam && !user.profile_completed) {
      return res.status(403).json({ error: "Complete profile before posting ads" });
    }

    if (!internalTeam && (!user.name || !user.city)) {
      return res.status(403).json({ error: "Complete name and city before posting ads" });
    }

    if (!internalTeam && !subscriptionActive) {
      return res.status(403).json({ error: "Subscription required" });
    }

    if (!internalTeam && role === "shop" && (user.shop_lat === null || user.shop_lng === null)) {
      return res.status(403).json({ error: "Pin exact shop location before posting ads" });
    }

    const rateResult = await pool.query(
      "SELECT price_per_gram FROM gold_rates WHERE NULLIF(regexp_replace(karat::text, '[^0-9]', '', 'g'), '')::int=$1 ORDER BY updated_at DESC LIMIT 1",
      [adPurity]
    );

    const goldRate = Number(rateResult.rows[0]?.price_per_gram || 0);

    const basePrice = goldRate * adWeight;
    const wastageAmount = wastage ? basePrice * (wastage / 100) : 0;
    const makingCharges = adMakingCharges || 0;
    const isNewGold = String(condition || "New").toLowerCase() === "new";

    if (!isNewGold && Number(price) > basePrice) {
      return res.status(400).json({ error: "Old gold price cannot be above market value" });
    }

    const finalPrice = isNewGold
      ? Number(price) || Math.round(basePrice + wastageAmount + makingCharges)
      : Number(price) || Math.round(basePrice);
    const suspicious = basePrice > 0 && finalPrice > basePrice * 2;
    const lowPriceWarning = basePrice > 0 && finalPrice < basePrice * 0.7;
    const adStatus = suspicious ? "inactive" : status || "active";

    const result = await pool.query(
      `INSERT INTO classified_ads 
      (user_id, title, description, grams, purity, wastage, making_charges,
       gold_rate_snapshot, price, city, category_id, metal, condition, images,
       seller_name, seller_role, shop_lat, shop_lng, shop_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *`,
      [
        user.id,
        title,
        description,
        adWeight,
        adPurity,
        isNewGold ? wastage : 0,
        isNewGold ? makingCharges : 0,
        goldRate,
        finalPrice,
        city || user.city || "",
        categoryId ?? category_id ?? "",
        metal ?? "Gold",
        condition ?? "New",
        Array.isArray(images) ? images : [],
        internalTeam ? "ExGold" : sellerName ?? "",
        role,
        user.shop_lat,
        user.shop_lng,
        user.shop_address || city || "",
      ]
    );

    if (adStatus !== "active") {
      await pool.query("UPDATE classified_ads SET status=$1 WHERE id=$2", [
        adStatus,
        result.rows[0].id,
      ]);
      result.rows[0].status = adStatus;
    }

    await pool.query(
      `UPDATE users
       SET ads_used = COALESCE(ads_used, 0) + 1,
           trial_used = CASE WHEN role = 'shop' THEN true ELSE trial_used END
       WHERE id=$1`,
      [user.id]
    );

    res.json({
      message: "Ad posted successfully",
      suspicious,
      warning: lowPriceWarning ? "Price is below 70% of gold value" : null,
      ad: rowToFlutterAd(result.rows[0]),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create ad" });
  }
};

/* ===============================
   GET ALL ADS
   =============================== */
export const getAds = async (req: Request, res: Response) => {
  try {
    const city = String(req.query.city || "").trim();
    const categoryId = String(req.query.categoryId || req.query.category_id || "").trim();
    const condition = String(req.query.condition || "").trim();
    const purity = String(req.query.purity || "").trim();
    const sort = String(req.query.sort || "latest").trim();
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 24)));
    const offset = (page - 1) * limit;
    const hasQuery = Object.keys(req.query || {}).length > 0;
    const where: string[] = ["ca.status='active'"];
    const values: any[] = [];

    const push = (value: any) => {
      values.push(value);
      return `$${values.length}`;
    };

    if (city) where.push(`LOWER(ca.city) = LOWER(${push(city)})`);
    if (categoryId) where.push(`ca.category_id = ${push(categoryId)}`);
    if (condition && condition.toLowerCase() !== "all") {
      where.push(`LOWER(ca.condition) = LOWER(${push(condition)})`);
    }
    if (purity && purity.toLowerCase() !== "all") {
      where.push(`${purityExpr("ca")} = ${push(parsePurity(purity))}`);
    }

    const whereSql = where.join(" AND ");
    const nearSort = sort === "near" && Number.isFinite(lat) && Number.isFinite(lng);
    const distanceSql = nearSort
      ? `, CASE
           WHEN ca.shop_lat IS NULL OR ca.shop_lng IS NULL THEN NULL
           ELSE (
             6371 * acos(
               LEAST(1, GREATEST(-1,
                 cos(radians(${push(lat)})) * cos(radians(ca.shop_lat)) *
                 cos(radians(ca.shop_lng) - radians(${push(lng)})) +
                 sin(radians(${push(lat)})) * sin(radians(ca.shop_lat))
               ))
             )
           )
         END AS distance_km`
      : "";
    const orderSql = nearSort
      ? "distance_km ASC NULLS LAST, ca.created_at DESC"
      : sort === "price_low"
      ? "ca.price ASC NULLS LAST, ca.created_at DESC"
      : sort === "price_high"
      ? "ca.price DESC NULLS LAST, ca.created_at DESC"
      : sort === "weight_high"
      ? "ca.grams DESC NULLS LAST, ca.created_at DESC"
      : "ca.created_at DESC";
    const limitParam = push(limit);
    const offsetParam = push(offset);

    const [result, adsSnap] = await Promise.all([
      pool.query(
      `SELECT ca.id, ca.title, ca.description, ca.grams, ca.purity, ca.wastage,
              ca.making_charges, ca.price, ca.city, ca.status, ca.created_at,
              ca.category_id, ca.metal, ca.condition, ca.images, ca.seller_name,
              ca.seller_role, ca.shop_lat, ca.shop_lng, ca.shop_address,
              ca.is_featured, ca.featured_until,
              gr.price_per_gram AS current_gold_rate,
              u.firebase_uid, u.name, u.role
              ${distanceSql}
       FROM classified_ads ca
       LEFT JOIN users u ON u.id = ca.user_id
       LEFT JOIN gold_rates gr ON ${karatExpr("gr")} = ${purityExpr("ca")}
       WHERE ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values
      ),
      admin.firestore().collection("ads").get().catch(() => null),
    ]);

    const adsById = new Map<string, any>();
    result.rows.map(rowToFlutterAd).forEach((ad) => adsById.set(ad.id, ad));

    if (page === 1) adsSnap?.docs.forEach((doc) => {
      if (adsById.has(doc.id)) return;
      const data = doc.data();
      if (String(data.status || "active").toLowerCase() !== "active") return;
      if (city && String(data.city || "").toLowerCase() !== city.toLowerCase()) return;
      if (categoryId && String(data.categoryId || data.category_id || "") !== categoryId) return;
      if (condition && condition.toLowerCase() !== "all" && String(data.condition || "New").toLowerCase() !== condition.toLowerCase()) return;
      if (purity && purity.toLowerCase() !== "all" && parsePurity(data.purity) !== parsePurity(purity)) return;
      adsById.set(doc.id, rowToFlutterAd({
        id: doc.id,
        title: data.title,
        description: data.description,
        grams: data.grams || data.weight,
        purity: data.purity,
        price: data.price,
        city: data.city,
        status: data.status || "active",
        is_featured: data.isFeatured || data.is_featured,
        featured_until: data.featuredUntil || data.featured_until,
        created_at: data.createdAt?.toDate?.()?.toISOString?.() || null,
        category_id: data.categoryId || data.category_id,
        metal: data.metal,
        condition: data.condition,
        images: data.images,
        seller_name: data.sellerName || data.seller_name,
        seller_role: data.sellerRole || data.seller_role,
        shop_lat: data.shopLat || data.shop_lat,
        shop_lng: data.shopLng || data.shop_lng,
        shop_address: data.shopAddress || data.shop_address,
        firebase_uid: data.sellerId || data.seller_id,
        name: data.sellerName,
        role: data.sellerRole,
      }));
    });

    const ads = Array.from(adsById.values());
    if (!hasQuery) return res.json(ads);

    res.json({
      data: ads.slice(0, limit),
      meta: {
        page,
        limit,
        count: ads.length,
        hasMore: result.rows.length === limit,
      },
    });
  } catch (error) {
    console.error("GET ADS ERROR:", error);
    res.status(500).json({ error: "Failed to fetch ads" });
  }
};

/* ===============================
   GET SINGLE AD
   =============================== */
export const getAdById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT ca.*, gr.price_per_gram AS current_gold_rate, u.firebase_uid, u.name, u.role
       FROM classified_ads ca
       LEFT JOIN users u ON u.id = ca.user_id
       LEFT JOIN gold_rates gr ON ${karatExpr("gr")} = ${purityExpr("ca")}
       WHERE ca.id=$1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Ad not found" });
    }

    res.json(rowToFlutterAd(result.rows[0]));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch ad" });
  }
};

/* ===============================
   GET MY ADS
   =============================== */
export const getMyAds = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user.uid;

    const result = await pool.query(
      `SELECT ca.*, gr.price_per_gram AS current_gold_rate, u.firebase_uid, u.name, u.role
       FROM classified_ads ca
       LEFT JOIN users u ON u.id = ca.user_id
       LEFT JOIN gold_rates gr ON ${karatExpr("gr")} = ${purityExpr("ca")}
       WHERE ca.user_id = (
         SELECT id FROM users WHERE firebase_uid=$1
       )
       AND ca.status <> 'deleted'
       ORDER BY ca.created_at DESC`,
      [uid]
    );

    res.json(result.rows.map(rowToFlutterAd));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch ads" });
  }
};

/* ===============================
   UPDATE AD
   =============================== */
export const updateAd = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const uid = req.user.uid;

    const {
      title,
      description,
      grams,
      weight,
      purity,
      wastage,
      making_charges,
      makingCharge,
      city,
      price,
      status,
      categoryId,
      category_id,
      metal,
      condition,
      images,
      sellerName,
    } = req.body;
    const adWeight = Number(grams ?? weight);
    const adPurity = parsePurity(purity);
    const adMakingCharges = Number(making_charges ?? makingCharge ?? 0);

    if (!adWeight || adWeight <= 0) {
      return res.status(400).json({ error: "Invalid weight" });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE firebase_uid=$1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    const rateResult = await pool.query(
      "SELECT price_per_gram FROM gold_rates WHERE NULLIF(regexp_replace(karat::text, '[^0-9]', '', 'g'), '')::int=$1 ORDER BY updated_at DESC LIMIT 1",
      [adPurity]
    );

    const goldRate = Number(rateResult.rows[0]?.price_per_gram || 0);

    const basePrice = goldRate * adWeight;
    const wastageAmount = wastage ? basePrice * (wastage / 100) : 0;
    const makingCharges = adMakingCharges || 0;

    const isNewGold = String(condition || "New").toLowerCase() === "new";

    if (!isNewGold && Number(price) > basePrice) {
      return res.status(400).json({ error: "Old gold price cannot be above market value" });
    }

    const finalPrice = isNewGold
      ? Number(price) || Math.round(basePrice + wastageAmount + makingCharges)
      : Number(price) || Math.round(basePrice);

    const result = await pool.query(
      `UPDATE classified_ads SET
        title=$1,
        description=$2,
        grams=$3,
        purity=$4,
        wastage=$5,
        making_charges=$6,
        gold_rate_snapshot=$7,
        price=$8,
        city=$9,
        category_id=$12,
        metal=$13,
        condition=$14,
        images=$15,
        seller_name=$16
        ${status ? ", status=$17" : ""}
       WHERE id=$10 AND user_id=$11
       RETURNING *`,
      [
        title,
        description,
        adWeight,
        adPurity,
        isNewGold ? wastage : 0,
        isNewGold ? makingCharges : 0,
        goldRate,
        finalPrice,
        city,
        id,
        userId,
        categoryId ?? category_id ?? "",
        metal ?? "Gold",
        condition ?? "New",
        Array.isArray(images) ? images : [],
        sellerName ?? "",
        ...(status ? [status] : []),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Ad not found or unauthorized" });
    }

    res.json({
      message: "Ad updated successfully",
      ad: rowToFlutterAd(result.rows[0]),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update ad" });
  }
};

/* ===============================
   DELETE AD
   =============================== */
export const deleteAd = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const uid = req.user.uid;

    await pool.query(
      `UPDATE classified_ads SET status='deleted'
       WHERE id=$1 
       AND user_id=(
         SELECT id FROM users WHERE firebase_uid=$2
       )`,
      [id, uid]
    );

    res.json({ message: "Ad deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete ad" });
  }
};

export const updateAdStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["active", "inactive", "sold", "deleted"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    await pool.query(
      `UPDATE classified_ads
       SET status=$1
       WHERE id=$2 AND user_id=(SELECT id FROM users WHERE firebase_uid=$3)`,
      [status, id, req.user.uid]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to update ad status" });
  }
};

export const activateFeaturedAd = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const days = Number(req.body.days || 7);
    const cost = Number(process.env.FEATURED_AD_COST || 99);

    if (days <= 0) {
      return res.status(400).json({ error: "Invalid featured duration" });
    }

    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT id FROM users WHERE firebase_uid=$1",
      [req.user.uid]
    );

    if (userResult.rows.length === 0) {
      throw new Error("User not found");
    }

    const userId = userResult.rows[0].id;
    const walletResult = await client.query(
      "SELECT balance FROM wallets WHERE user_id=$1",
      [userId]
    );

    const balance = Number(walletResult.rows[0]?.balance || 0);
    if (balance < cost) {
      await client.query("ROLLBACK");
      return res.status(402).json({ error: "Wallet recharge required" });
    }

    const adResult = await client.query(
      `UPDATE classified_ads
       SET is_featured=true,
           featured_until=NOW() + ($1 || ' days')::interval
       WHERE id=$2 AND user_id=$3
       RETURNING *`,
      [days, id, userId]
    );

    if (adResult.rows.length === 0) {
      throw new Error("Ad not found or unauthorized");
    }

    await client.query(
      "UPDATE wallets SET balance=balance-$1 WHERE user_id=$2",
      [cost, userId]
    );

    await client.query(
      `INSERT INTO wallet_transactions
       (user_id, type, amount, method, status)
       VALUES ($1, 'debit', $2, 'featured_ad', 'success')`,
      [userId, cost]
    );

    await client.query("COMMIT");

    res.json({ success: true, cost, ad: rowToFlutterAd(adResult.rows[0]) });
  } catch (error: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message || "Failed to feature ad" });
  } finally {
    client.release();
  }
};

export const getCategories = async (_req: Request, res: Response) => {
  res.json([
    { id: "1", name: "Rings", image: "assets/images/rings.jpg", type: "jewellery" },
    { id: "2", name: "Chains", image: "assets/images/chains.jpg", type: "jewellery" },
    { id: "3", name: "Necklace", image: "assets/images/necklace.jpg", type: "jewellery" },
    { id: "4", name: "Earrings", image: "assets/images/earrings.jpg", type: "jewellery" },
    { id: "5", name: "Bangles", image: "assets/images/bangles.jpg", type: "jewellery" },
  ]);
};
