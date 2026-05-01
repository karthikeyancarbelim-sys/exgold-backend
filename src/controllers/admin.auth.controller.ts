import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { pool } from "../config/db";

const JWT_SECRET = process.env.JWT_SECRET || "secretkey";

export const adminLogin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    /* ===============================
       VALIDATION
    =============================== */
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    /* ===============================
       GET ADMIN USER
    =============================== */
    const result = await pool.query(
      `
      SELECT 
        id,
        email,
        password,
        role,
        status,
        created_at
      FROM admins
      WHERE email = $1
      LIMIT 1
      `,
      [cleanEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const admin = result.rows[0];

    /* ===============================
       STATUS CHECK
    =============================== */
    if (admin.status && admin.status === "blocked") {
      return res.status(403).json({
        success: false,
        message: "Account blocked",
      });
    }

    /* ===============================
       PASSWORD CHECK
       Supports both:
       1. Plain text old passwords
       2. bcrypt hashed passwords
    =============================== */
    let passwordMatched = false;

    if (
      admin.password &&
      (admin.password.startsWith("$2a$") ||
        admin.password.startsWith("$2b$") ||
        admin.password.startsWith("$2y$"))
    ) {
      passwordMatched = await bcrypt.compare(password, admin.password);
    } else {
      passwordMatched = admin.password === password;
    }

    if (!passwordMatched) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    /* ===============================
       UPDATE LAST LOGIN
    =============================== */
    await pool.query(
      `
      UPDATE admins
      SET last_login = NOW()
      WHERE id = $1
      `,
      [admin.id]
    );

    /* ===============================
       JWT TOKEN
    =============================== */
    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        role: admin.role || "admin",
      },
      JWT_SECRET,
      {
        expiresIn: "1d",
      }
    );

    /* ===============================
       RESPONSE
    =============================== */
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role || "admin",
      },
    });
  } catch (error) {
    console.error("Admin login error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};