// ===============================
// rateLimit.middleware.ts (FIXED)
// ===============================
import rateLimit from "express-rate-limit";
import { Request, Response } from "express";

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: "Too many requests, please try again later",
    });
  },
});