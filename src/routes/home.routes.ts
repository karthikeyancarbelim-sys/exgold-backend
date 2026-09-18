import express from "express";
import { getHomeSlides } from "../controllers/home.controller";

const router = express.Router();

router.get("/slides", getHomeSlides);

export default router;
