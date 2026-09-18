"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPublicAppConfig = void 0;
const db_1 = require("../config/db");
const defaultUpdateConfig = {
    latestVersion: "1.31.1",
    latestBuild: 41,
    minimumVersion: "1.31.0",
    minimumBuild: 40,
    forceUpdate: false,
    title: "Update ExGold",
    message: "A newer ExGold version may be available with security, checkout and delivery improvements.",
    androidUrl: "https://play.google.com/store/apps/details?id=in.exgold.app",
};
const getPublicAppConfig = async (_req, res) => {
    try {
        const result = await db_1.pool.query("SELECT value, updated_at FROM app_settings WHERE key='app_update'");
        return res.json({
            update: {
                ...defaultUpdateConfig,
                ...(result.rows[0]?.value || {}),
                updatedAt: result.rows[0]?.updated_at || null,
            },
        });
    }
    catch (error) {
        console.error("GET PUBLIC APP CONFIG ERROR:", error);
        return res.json({ update: defaultUpdateConfig });
    }
};
exports.getPublicAppConfig = getPublicAppConfig;
