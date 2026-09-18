import express from "express";
import { getPublicAppConfig } from "../controllers/app.controller";

const router = express.Router();

router.get("/config", getPublicAppConfig);

export default router;
