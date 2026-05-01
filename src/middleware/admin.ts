import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";

export const verifyAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const role = req.user?.role;

    // ✅ allow both admin & superadmin
    if (!role || (role !== "admin" && role !== "superadmin")) {
      return res.status(403).json({ message: "Admin access required" });
    }

    next();
  } catch {
    res.status(500).json({ message: "Admin check failed" });
  }
};