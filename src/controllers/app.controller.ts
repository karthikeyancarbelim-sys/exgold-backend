import { Request, Response } from "express";
import { pool } from "../config/db";

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

export const getPublicAppConfig = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT value, updated_at FROM app_settings WHERE key='app_update'"
    );

    return res.json({
      update: {
        ...defaultUpdateConfig,
        ...(result.rows[0]?.value || {}),
        updatedAt: result.rows[0]?.updated_at || null,
      },
    });
  } catch (error) {
    console.error("GET PUBLIC APP CONFIG ERROR:", error);
    return res.json({ update: defaultUpdateConfig });
  }
};
