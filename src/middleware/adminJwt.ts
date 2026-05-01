import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthRequest } from "./auth";

const JWT_SECRET = process.env.JWT_SECRET || "secretkey";

export const verifyAdminJWT = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "No token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // ✅ keep everything consistent
    req.user = decoded as any;

    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};