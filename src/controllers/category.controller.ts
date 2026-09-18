import { Request, Response } from "express";
import { pool } from "../config/db";

const fallbackCategories = [
  { id: "1", name: "Rings", image: "assets/images/rings.jpg", type: "jewellery", sortOrder: 1, isActive: true },
  { id: "2", name: "Chains", image: "assets/images/chains.jpg", type: "jewellery", sortOrder: 2, isActive: true },
  { id: "3", name: "Necklace", image: "assets/images/necklace.jpg", type: "jewellery", sortOrder: 3, isActive: true },
  { id: "4", name: "Earrings", image: "assets/images/earrings.jpg", type: "jewellery", sortOrder: 4, isActive: true },
  { id: "5", name: "Bangles", image: "assets/images/bangles.jpg", type: "jewellery", sortOrder: 5, isActive: true },
  { id: "7", name: "Old Gold", image: "assets/images/default.jpg", type: "jewellery", sortOrder: 7, isActive: true },
];

const toCategory = (row: any) => ({
  id: String(row.id),
  name: row.name || "",
  image: row.image || "",
  type: row.type || "jewellery",
  sortOrder: Number(row.sort_order || row.sortOrder || 0),
  isActive: row.is_active !== false,
});

export const getJewelleryCategories = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM categories
       WHERE is_active=true AND type='jewellery'
       ORDER BY sort_order ASC, name ASC`
    );

    return res.json(result.rows.length ? result.rows.map(toCategory) : fallbackCategories);
  } catch (error) {
    console.error("GET CATEGORIES ERROR:", error);
    return res.json(fallbackCategories);
  }
};

export const getAllCategories = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM categories ORDER BY sort_order ASC, name ASC`
    );
    return res.json(result.rows.map(toCategory));
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch categories" });
  }
};

export const createCategory = async (req: Request, res: Response) => {
  try {
    const id = String(req.body.id || Date.now());
    const result = await pool.query(
      `INSERT INTO categories (id, name, image, type, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        id,
        req.body.name || "",
        req.body.image || "",
        req.body.type || "jewellery",
        Number(req.body.sortOrder || req.body.sort_order || 0),
        req.body.isActive ?? req.body.is_active ?? true,
      ]
    );
    return res.status(201).json({ success: true, category: toCategory(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create category" });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE categories
       SET name=$1, image=$2, type=$3, sort_order=$4, is_active=$5, updated_at=NOW()
       WHERE id=$6
       RETURNING *`,
      [
        req.body.name || "",
        req.body.image || "",
        req.body.type || "jewellery",
        Number(req.body.sortOrder || req.body.sort_order || 0),
        req.body.isActive ?? req.body.is_active ?? true,
        req.params.id,
      ]
    );

    if (!result.rows.length) return res.status(404).json({ message: "Category not found" });
    return res.json({ success: true, category: toCategory(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update category" });
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE categories SET is_active=false, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );

    if (!result.rows.length) return res.status(404).json({ message: "Category not found" });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete category" });
  }
};
