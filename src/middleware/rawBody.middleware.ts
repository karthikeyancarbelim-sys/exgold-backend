// ===============================
// rawBody.middleware.ts
// ===============================
import { Request, Response, NextFunction } from "express";

export const rawBodyMiddleware = (
  req: any,
  _res: Response,
  next: NextFunction
) => {
  let data = "";

  req.on("data", (chunk: any) => {
    data += chunk;
  });

  req.on("end", () => {
    req.rawBody = data;
    next();
  });
};