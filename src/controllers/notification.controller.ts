import { Response } from "express";
import { AuthRequest } from "../middleware/auth";

export const getMyNotifications = async (_req: AuthRequest, res: Response) => {
  return res.json([]);
};

export const markNotificationRead = async (_req: AuthRequest, res: Response) => {
  return res.json({ success: true });
};
