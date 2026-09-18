"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const normalizeDbHost = (host = "") => {
    const trimmed = host.trim();
    if (!trimmed)
        return trimmed;
    try {
        const parsed = new URL(trimmed);
        const hostname = parsed.hostname;
        if (hostname.includes(".apirest.")) {
            const [project, ...rest] = hostname.split(".apirest.");
            return `${project}-pooler.${rest.join(".apirest.")}`;
        }
        return hostname;
    }
    catch {
        return trimmed;
    }
};
const databaseUrl = process.env.DATABASE_URL || "";
const useDatabaseUrl = databaseUrl && !databaseUrl.includes("YOUR_PASSWORD");
exports.pool = new pg_1.Pool(useDatabaseUrl
    ? {
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
    }
    : {
        user: process.env.DB_USER,
        host: normalizeDbHost(process.env.DB_HOST),
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: Number(process.env.DB_PORT || 5432),
        ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
exports.pool.connect()
    .then(async (client) => {
    console.log("PostgreSQL connected");
    client.release();
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        firebase_uid TEXT UNIQUE NOT NULL,
        name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS user_addresses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        augmont_address_id TEXT,
        label TEXT DEFAULT 'Home',
        full_name TEXT DEFAULT '',
        mobile TEXT DEFAULT '',
        line1 TEXT DEFAULT '',
        line2 TEXT DEFAULT '',
        city TEXT DEFAULT '',
        state TEXT DEFAULT '',
        pincode TEXT DEFAULT '',
        country TEXT DEFAULT 'India',
        is_default BOOLEAN DEFAULT false,
        provider_payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id
      ON user_addresses(user_id)
    `);
    await exports.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_addresses_single_default
      ON user_addresses(user_id)
      WHERE is_default = true
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS wishlist_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL DEFAULT 'ad',
        item_key TEXT NOT NULL,
        title TEXT DEFAULT '',
        image_url TEXT DEFAULT '',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, item_type, item_key)
      )
    `);
    await exports.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_wishlist_items_user_created
      ON wishlist_items(user_id, created_at DESC)
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        status TEXT DEFAULT 'active',
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      ALTER TABLE admins
      ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin',
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS reset_password_token_hash TEXT,
      ADD COLUMN IF NOT EXISTS reset_password_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reset_password_used_at TIMESTAMPTZ
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id),
        balance NUMERIC DEFAULT 0,
        reserved_balance NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      ALTER TABLE wallets
      ADD COLUMN IF NOT EXISTS reserved_balance NUMERIC DEFAULT 0
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type TEXT NOT NULL,
        amount NUMERIC NOT NULL DEFAULT 0,
        method TEXT DEFAULT '',
        reason TEXT DEFAULT '',
        reference_id TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      ALTER TABLE wallet_transactions
      ADD COLUMN IF NOT EXISTS user_id INTEGER,
      ADD COLUMN IF NOT EXISTS type TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS method TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS reference_id TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);
    await exports.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reference_id
      ON wallet_transactions(reference_id)
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawal_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        account_holder_name TEXT DEFAULT '',
        bank_name TEXT DEFAULT '',
        account_number TEXT DEFAULT '',
        ifsc TEXT DEFAULT '',
        upi_id TEXT DEFAULT '',
        preferred_method TEXT DEFAULT 'bank',
        bank_verified BOOLEAN DEFAULT false,
        upi_verified BOOLEAN DEFAULT false,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      ALTER TABLE withdrawal_accounts
      ADD COLUMN IF NOT EXISTS verification_provider TEXT DEFAULT 'nerotix',
      ADD COLUMN IF NOT EXISTS bank_verification_status TEXT DEFAULT 'not_started',
      ADD COLUMN IF NOT EXISTS bank_verification_reference TEXT,
      ADD COLUMN IF NOT EXISTS bank_verification_utr TEXT,
      ADD COLUMN IF NOT EXISTS verified_account_holder_name TEXT,
      ADD COLUMN IF NOT EXISTS bank_verification_payload JSONB,
      ADD COLUMN IF NOT EXISTS bank_verification_error TEXT,
      ADD COLUMN IF NOT EXISTS bank_verified_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS name_match_status TEXT DEFAULT 'not_checked',
      ADD COLUMN IF NOT EXISTS augmont_user_bank_id TEXT,
      ADD COLUMN IF NOT EXISTS augmont_bank_synced_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS augmont_bank_payload JSONB,
      ADD COLUMN IF NOT EXISTS augmont_bank_sync_error TEXT,
      ADD COLUMN IF NOT EXISTS modification_count INTEGER NOT NULL DEFAULT 0
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        withdrawal_account_id INTEGER REFERENCES withdrawal_accounts(id),
        amount NUMERIC NOT NULL DEFAULT 0,
        method TEXT DEFAULT 'bank',
        status TEXT DEFAULT 'pending',
        admin_notes TEXT DEFAULT '',
        processed_reference TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      ALTER TABLE withdrawal_requests
      ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS provider_status TEXT DEFAULT 'not_started',
      ADD COLUMN IF NOT EXISTS provider_reference TEXT,
      ADD COLUMN IF NOT EXISTS provider_payload JSONB,
      ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
      ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS failure_reason TEXT
    `);
    await exports.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawal_requests_user_idempotency
      ON withdrawal_requests(user_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type TEXT NOT NULL DEFAULT '',
        amount NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'pending',
        reference_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS user_id INTEGER,
      ADD COLUMN IF NOT EXISTS type TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS reference_id TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);
    await exports.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_reference_id
      ON transactions(reference_id)
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS classified_ads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title TEXT NOT NULL DEFAULT '',
        description TEXT DEFAULT '',
        grams NUMERIC DEFAULT 0,
        purity INTEGER DEFAULT 22,
        wastage NUMERIC DEFAULT 0,
        making_charges NUMERIC DEFAULT 0,
        gold_rate_snapshot NUMERIC DEFAULT 0,
        price NUMERIC DEFAULT 0,
        city TEXT DEFAULT '',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      DO $$
      DECLARE
        column_type TEXT;
      BEGIN
        SELECT udt_name
        INTO column_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'classified_ads'
          AND column_name = 'user_id';

        IF column_type = 'uuid' THEN
          ALTER TABLE classified_ads
          ALTER COLUMN user_id TYPE INTEGER
          USING NULL;
        END IF;
      END $$;
    `);
    await exports.pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS dob TEXT,
      ADD COLUMN IF NOT EXISTS gender TEXT,
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'buyer',
      ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS subscription_active BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS subscription_start TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS subscription_end TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS trial_used BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS kyc_verified BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS kycaid_applicant_id TEXT,
      ADD COLUMN IF NOT EXISTS kycaid_verification_id TEXT,
      ADD COLUMN IF NOT EXISTS kyc_completed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ads_used INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ads_limit INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS gold_balance NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS photo_url TEXT,
      ADD COLUMN IF NOT EXISTS shop_lat NUMERIC,
      ADD COLUMN IF NOT EXISTS shop_lng NUMERIC,
      ADD COLUMN IF NOT EXISTS shop_address TEXT,
      ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS referral_code TEXT
    `);
    await exports.pool.query(`
      ALTER TABLE classified_ads
      ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS grams NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS purity INTEGER DEFAULT 22,
      ADD COLUMN IF NOT EXISTS wastage NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS making_charges NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS gold_rate_snapshot NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS category_id TEXT,
      ADD COLUMN IF NOT EXISTS metal TEXT DEFAULT 'Gold',
      ADD COLUMN IF NOT EXISTS condition TEXT DEFAULT 'New',
      ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS seller_name TEXT,
      ADD COLUMN IF NOT EXISTS seller_role TEXT,
      ADD COLUMN IF NOT EXISTS shop_lat NUMERIC,
      ADD COLUMN IF NOT EXISTS shop_lng NUMERIC,
      ADD COLUMN IF NOT EXISTS shop_address TEXT,
      ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS gold_rates (
        karat INTEGER PRIMARY KEY,
        price_per_gram NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      ALTER TABLE gold_rates
      ADD COLUMN IF NOT EXISTS karat INTEGER,
      ADD COLUMN IF NOT EXISTS price_per_gram NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS gold_margin (
        karat INTEGER PRIMARY KEY,
        buy_margin NUMERIC NOT NULL DEFAULT 0,
        sell_margin NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        image TEXT DEFAULT '',
        type TEXT DEFAULT 'jewellery',
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS home_slides (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT DEFAULT '',
        image_url TEXT DEFAULT '',
        cta_label TEXT DEFAULT '',
        cta_action TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS gold_rate_history (
        id SERIAL PRIMARY KEY,
        karat INTEGER NOT NULL,
        price_per_gram NUMERIC NOT NULL,
        source TEXT DEFAULT 'admin',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    for (const karat of [18, 22, 24]) {
        const existingMargin = await exports.pool.query("SELECT karat FROM gold_margin WHERE karat=$1 LIMIT 1", [karat]);
        if (!existingMargin.rows.length) {
            await exports.pool.query("INSERT INTO gold_margin (karat, buy_margin, sell_margin) VALUES ($1, 0, 0)", [karat]);
        }
    }
    const defaultCategories = [
        ["1", "Rings", "assets/images/rings.jpg", "jewellery", 1],
        ["2", "Chains", "assets/images/chains.jpg", "jewellery", 2],
        ["3", "Necklace", "assets/images/necklace.jpg", "jewellery", 3],
        ["4", "Earrings", "assets/images/earrings.jpg", "jewellery", 4],
        ["5", "Bangles", "assets/images/bangles.jpg", "jewellery", 5],
        ["6", "Gold Coins", "assets/images/default.jpg", "investment", 6],
        ["7", "Old Gold", "assets/images/default.jpg", "jewellery", 7],
    ];
    for (const [id, name, image, type, sortOrder] of defaultCategories) {
        const existingCategory = await exports.pool.query("SELECT id FROM categories WHERE id=$1 LIMIT 1", [id]);
        if (!existingCategory.rows.length) {
            await exports.pool.query(`INSERT INTO categories (id, name, image, type, sort_order)
           VALUES ($1, $2, $3, $4, $5)`, [id, name, image, type, sortOrder]);
        }
    }
    await exports.pool.query(`
      INSERT INTO home_slides
        (title, subtitle, image_url, cta_label, cta_action, sort_order)
      SELECT * FROM (VALUES
        (
          'Verified Gold Classifieds',
          'Discover shop and old gold listings near your city.',
          'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1200&q=80',
          'Explore',
          'classifieds',
          1
        ),
        (
          'Track Today Gold Value',
          'Follow 18K, 22K and 24K price movement before you buy.',
          'https://images.unsplash.com/photo-1610375461246-83df859d849d?auto=format&fit=crop&w=1200&q=80',
          'View Rates',
          'rates',
          2
        ),
        (
          'Build Gold Investments',
          'Buy digital gold, start SIPs and track your gold balance.',
          'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1200&q=80',
          'Invest',
          'investment',
          3
        )
      ) AS defaults(title, subtitle, image_url, cta_label, cta_action, sort_order)
      WHERE NOT EXISTS (SELECT 1 FROM home_slides)
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS gold_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        augmont_txn_id TEXT,
        merchant_txn_id TEXT,
        provider TEXT DEFAULT 'manual',
        provider_payload JSONB,
        type TEXT NOT NULL,
        amount NUMERIC DEFAULT 0,
        gold_grams NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      DO $$
      DECLARE
        column_type TEXT;
      BEGIN
        SELECT udt_name
        INTO column_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'gold_transactions'
          AND column_name = 'user_id';

        IF column_type = 'uuid' THEN
          ALTER TABLE gold_transactions
          ALTER COLUMN user_id TYPE INTEGER
          USING NULL;
        END IF;
      END $$;
    `);
    await exports.pool.query(`
      ALTER TABLE gold_transactions
      ADD COLUMN IF NOT EXISTS augmont_txn_id TEXT,
      ADD COLUMN IF NOT EXISTS merchant_txn_id TEXT,
      ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS provider_payload JSONB,
      ADD COLUMN IF NOT EXISTS type TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS gold_grams NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS withdrawal_account_id INTEGER REFERENCES withdrawal_accounts(id),
      ADD COLUMN IF NOT EXISTS payout_route TEXT,
      ADD COLUMN IF NOT EXISTS payout_status TEXT,
      ADD COLUMN IF NOT EXISTS payout_reference TEXT,
      ADD COLUMN IF NOT EXISTS gold_restored_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);
    await exports.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gold_transactions_merchant_txn_id
      ON gold_transactions(merchant_txn_id)
      WHERE merchant_txn_id IS NOT NULL AND merchant_txn_id <> ''
    `);
    await exports.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_gold_transactions_user_status
      ON gold_transactions(user_id, status)
    `);
    await exports.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_gold_transactions_pending_payout
      ON gold_transactions(payout_route, payout_status)
      WHERE type='sell' AND settled_at IS NULL
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS augmont_merchant_settlements (
        id SERIAL PRIMARY KEY,
        gold_transaction_id INTEGER NOT NULL UNIQUE REFERENCES gold_transactions(id),
        direction TEXT NOT NULL,
        amount NUMERIC NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        due_date DATE NOT NULL,
        settlement_reference TEXT,
        settled_amount NUMERIC,
        admin_notes TEXT,
        settled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_augmont_merchant_settlements_status_due
      ON augmont_merchant_settlements(status, due_date)
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS provider_auth_sessions (
        provider TEXT PRIMARY KEY,
        access_token_encrypted TEXT NOT NULL,
        token_iv TEXT NOT NULL,
        token_auth_tag TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ NOT NULL,
        authenticated_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      INSERT INTO augmont_merchant_settlements
        (gold_transaction_id, direction, amount, status, due_date)
      SELECT
        gt.id,
        CASE WHEN gt.type='buy'
          THEN 'payable_to_augmont'
          ELSE 'receivable_from_augmont'
        END,
        gt.amount,
        'pending',
        (gt.created_at AT TIME ZONE 'Asia/Kolkata')::date + 1
      FROM gold_transactions gt
      WHERE gt.type IN ('buy','sell')
        AND LOWER(COALESCE(gt.status,'')) IN ('success','completed')
        AND COALESCE(gt.amount,0) > 0
        AND (
          gt.type='buy'
          OR (gt.type='sell' AND gt.payout_route='exgold_wallet')
        )
      ON CONFLICT (gold_transaction_id) DO NOTHING
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS checkout_intents (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        purpose TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        status TEXT NOT NULL DEFAULT 'created',
        razorpay_order_id TEXT UNIQUE,
        razorpay_payment_id TEXT UNIQUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        provider_payload JSONB,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_checkout_intents_user_status
      ON checkout_intents(user_id, status, created_at DESC)
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subject TEXT NOT NULL,
        message TEXT DEFAULT '',
        category TEXT DEFAULT 'general',
        priority TEXT DEFAULT 'normal',
        status TEXT DEFAULT 'open',
        assigned_to TEXT,
        admin_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        ad_id TEXT,
        buyer_uid TEXT NOT NULL,
        seller_uid TEXT NOT NULL,
        buyer_name TEXT DEFAULT '',
        seller_name TEXT DEFAULT '',
        status TEXT DEFAULT 'active',
        last_message TEXT DEFAULT '',
        last_message_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        conversation_id TEXT REFERENCES chat_conversations(id),
        sender_uid TEXT NOT NULL,
        receiver_uid TEXT NOT NULL,
        type TEXT DEFAULT 'text',
        text TEXT DEFAULT '',
        amount NUMERIC,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        actor TEXT DEFAULT 'admin',
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO NOTHING`, [
        "app_update",
        {
            latestVersion: "1.31.1",
            latestBuild: 41,
            minimumVersion: "1.31.0",
            minimumBuild: 40,
            forceUpdate: false,
            title: "Update ExGold",
            message: "A newer ExGold version may be available with security, checkout and delivery improvements.",
            androidUrl: "https://play.google.com/store/apps/details?id=in.exgold.app",
        },
    ]);
    const existingExgoldUser = await exports.pool.query("SELECT id FROM users WHERE firebase_uid=$1 ORDER BY id LIMIT 1", ["internal_exgold"]);
    const exgoldUser = existingExgoldUser.rows.length
        ? await exports.pool.query(`UPDATE users
           SET name='ExGold',
               role='internal',
               profile_completed=true,
               ads_limit=999
           WHERE id=$1
           RETURNING id`, [existingExgoldUser.rows[0].id])
        : await exports.pool.query(`INSERT INTO users (firebase_uid, name, phone, role, city, profile_completed, ads_limit)
           VALUES ('internal_exgold','ExGold','','internal','India',true,999)
           RETURNING id`);
    const existingExgoldWallet = await exports.pool.query("SELECT id FROM wallets WHERE user_id=$1 LIMIT 1", [exgoldUser.rows[0].id]);
    if (!existingExgoldWallet.rows.length) {
        await exports.pool.query(`
        INSERT INTO wallets (user_id, balance)
        VALUES ($1, 0)
      `, [exgoldUser.rows[0].id]);
    }
    const adUserIdColumn = await exports.pool.query(`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_name='classified_ads'
        AND column_name='user_id'
      LIMIT 1
    `);
    const adUserIdType = String(adUserIdColumn.rows[0]?.udt_name || adUserIdColumn.rows[0]?.data_type || "");
    const canSeedNumericAdUser = adUserIdType.includes("int") || adUserIdType === "numeric";
    if (canSeedNumericAdUser && process.env.SEED_EXGOLD_DEMO_ADS === "true") {
        await exports.pool.query(`
        INSERT INTO classified_ads
        (user_id, title, description, grams, purity, wastage, making_charges,
         gold_rate_snapshot, price, city, category_id, metal, condition, images,
         seller_name, seller_role, shop_address, status)
        VALUES
        ($1,'ExGold 22K Ring','New 22K gold ring from ExGold.',8,22,8,1200,0,0,'Chennai','1','Gold','New',ARRAY['https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=80']::TEXT[],'ExGold','shop','ExGold verified listing','active'),
        ($1,'ExGold Gold Chain','New 22K gold chain from ExGold.',16,22,10,2500,0,0,'Chennai','5','Gold','New',ARRAY['https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=900&q=80']::TEXT[],'ExGold','shop','ExGold verified listing','active'),
        ($1,'ExGold Bangles Pair','New 22K bangles pair from ExGold.',24,22,9,3500,0,0,'Chennai','4','Gold','New',ARRAY['https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80']::TEXT[],'ExGold','shop','ExGold verified listing','active'),
        ($1,'ExGold Necklace','New 22K necklace from ExGold.',32,22,11,5500,0,0,'Chennai','3','Gold','New',ARRAY['https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=900&q=80']::TEXT[],'ExGold','shop','ExGold verified listing','active'),
        ($1,'ExGold Earrings','New 22K earrings from ExGold.',6,22,8,900,0,0,'Chennai','3','Gold','New',ARRAY['https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=80']::TEXT[],'ExGold','shop','ExGold verified listing','active')
        ON CONFLICT DO NOTHING
      `, [exgoldUser.rows[0].id]);
        await exports.pool.query(`
        UPDATE classified_ads
        SET images = CASE
          WHEN title ILIKE '%ring%' THEN ARRAY['https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=80']::TEXT[]
          WHEN title ILIKE '%chain%' THEN ARRAY['https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=900&q=80']::TEXT[]
          WHEN title ILIKE '%bangle%' THEN ARRAY['https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80']::TEXT[]
          WHEN title ILIKE '%necklace%' THEN ARRAY['https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=900&q=80']::TEXT[]
          WHEN title ILIKE '%earring%' THEN ARRAY['https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=80']::TEXT[]
          ELSE images
        END
        WHERE user_id = $1 AND (images IS NULL OR array_length(images, 1) IS NULL)
      `, [exgoldUser.rows[0].id]);
        await exports.pool.query(`
        UPDATE classified_ads
        SET gold_rate_snapshot=0, price=0
        WHERE user_id=$1
          AND seller_name='ExGold'
          AND condition='New'
      `, [exgoldUser.rows[0].id]);
    }
    await exports.pool.query(`
      CREATE TABLE IF NOT EXISTS kyc (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        status TEXT DEFAULT 'none',
        reference_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await exports.pool.query(`
      DO $$
      DECLARE
        column_type TEXT;
      BEGIN
        SELECT udt_name
        INTO column_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'kyc'
          AND column_name = 'user_id';

        IF column_type = 'uuid' THEN
          ALTER TABLE kyc
          ALTER COLUMN user_id TYPE INTEGER
          USING NULL;
        END IF;
      END $$;
    `);
    await exports.pool.query(`
      ALTER TABLE kyc
      ADD COLUMN IF NOT EXISTS reference_id TEXT,
      ADD COLUMN IF NOT EXISTS aadhaar_status TEXT DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS pan_status TEXT DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS video_status TEXT DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS aadhaar_reference_id TEXT,
      ADD COLUMN IF NOT EXISTS pan_reference_id TEXT,
      ADD COLUMN IF NOT EXISTS video_reference_id TEXT,
      ADD COLUMN IF NOT EXISTS kycaid_applicant_id TEXT,
      ADD COLUMN IF NOT EXISTS kycaid_verification_id TEXT,
      ADD COLUMN IF NOT EXISTS kycaid_form_url TEXT,
      ADD COLUMN IF NOT EXISTS kycaid_payload JSONB,
      ADD COLUMN IF NOT EXISTS kyc_provider TEXT DEFAULT 'kycaid',
      ADD COLUMN IF NOT EXISTS nerotix_txn_id TEXT,
      ADD COLUMN IF NOT EXISTS nerotix_reference_id TEXT,
      ADD COLUMN IF NOT EXISTS nerotix_payload JSONB,
      ADD COLUMN IF NOT EXISTS aadhaar_payload JSONB,
      ADD COLUMN IF NOT EXISTS pan_payload JSONB,
      ADD COLUMN IF NOT EXISTS aadhaar_masked TEXT,
      ADD COLUMN IF NOT EXISTS pan_masked TEXT,
      ADD COLUMN IF NOT EXISTS pan_number TEXT,
      ADD COLUMN IF NOT EXISTS pan_name TEXT,
      ADD COLUMN IF NOT EXISTS augmont_kyc_status TEXT,
      ADD COLUMN IF NOT EXISTS augmont_kyc_synced_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS augmont_kyc_payload JSONB,
      ADD COLUMN IF NOT EXISTS augmont_kyc_error JSONB,
      ADD COLUMN IF NOT EXISTS kyc_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS kyc_reverify_reason TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);
    await exports.pool.query(`
      UPDATE kyc
      SET kyc_expires_at = COALESCE(updated_at, created_at, NOW()) + INTERVAL '365 days',
          status = CASE
            WHEN aadhaar_status='approved' AND pan_status='approved' THEN 'full'
            ELSE status
          END
      WHERE kyc_expires_at IS NULL
        AND (
          status IN ('full','approved','APPROVED')
          OR (aadhaar_status='approved' AND pan_status='approved')
        )
    `);
    await exports.pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS kyc_completed_at TIMESTAMPTZ
    `);
    await exports.pool.query(`
      UPDATE users u
      SET kyc_status = CASE WHEN k.kyc_expires_at <= NOW() THEN 'expired' ELSE 'full' END,
          kyc_verified = CASE WHEN k.kyc_expires_at > NOW() THEN true ELSE false END,
          kyc_completed_at = CASE
            WHEN k.kyc_expires_at > NOW() THEN COALESCE(u.kyc_completed_at, k.updated_at, k.created_at, NOW())
            ELSE u.kyc_completed_at
          END
      FROM (
        SELECT DISTINCT ON (user_id) *
        FROM kyc
        WHERE status IN ('full','approved','APPROVED')
           OR (aadhaar_status='approved' AND pan_status='approved')
        ORDER BY user_id, updated_at DESC NULLS LAST, created_at DESC
      ) k
      WHERE u.id = k.user_id
    `);
})
    .catch((err) => console.error("Database connection error:", err));
