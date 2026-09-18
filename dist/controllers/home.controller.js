"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteHomeSlide = exports.updateHomeSlide = exports.createHomeSlide = exports.getAllHomeSlides = exports.getHomeSlides = void 0;
const db_1 = require("../config/db");
const getHomeSlides = async (_req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT id, title, subtitle, image_url, cta_label, cta_action, sort_order
       FROM home_slides
       WHERE is_active = true
       ORDER BY sort_order ASC, id ASC`);
        return res.json(result.rows);
    }
    catch {
        return res.status(500).json({ message: "Failed to fetch home slides" });
    }
};
exports.getHomeSlides = getHomeSlides;
const getAllHomeSlides = async (_req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT * FROM home_slides ORDER BY sort_order ASC, id ASC`);
        return res.json(result.rows);
    }
    catch {
        return res.status(500).json({ message: "Failed to fetch slides" });
    }
};
exports.getAllHomeSlides = getAllHomeSlides;
const createHomeSlide = async (req, res) => {
    try {
        const result = await db_1.pool.query(`INSERT INTO home_slides
       (title, subtitle, image_url, cta_label, cta_action, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`, [
            req.body.title,
            req.body.subtitle || "",
            req.body.imageUrl || req.body.image_url || "",
            req.body.ctaLabel || req.body.cta_label || "",
            req.body.ctaAction || req.body.cta_action || "",
            Number(req.body.sortOrder || req.body.sort_order || 0),
            req.body.isActive ?? req.body.is_active ?? true,
        ]);
        return res.status(201).json({ success: true, slide: result.rows[0] });
    }
    catch {
        return res.status(500).json({ message: "Failed to create slide" });
    }
};
exports.createHomeSlide = createHomeSlide;
const updateHomeSlide = async (req, res) => {
    try {
        const result = await db_1.pool.query(`UPDATE home_slides
       SET title=COALESCE($1,title),
           subtitle=COALESCE($2,subtitle),
           image_url=COALESCE($3,image_url),
           cta_label=COALESCE($4,cta_label),
           cta_action=COALESCE($5,cta_action),
           sort_order=COALESCE($6,sort_order),
           is_active=COALESCE($7,is_active),
           updated_at=NOW()
       WHERE id=$8
       RETURNING *`, [
            req.body.title,
            req.body.subtitle,
            req.body.imageUrl || req.body.image_url,
            req.body.ctaLabel || req.body.cta_label,
            req.body.ctaAction || req.body.cta_action,
            req.body.sortOrder ?? req.body.sort_order,
            req.body.isActive ?? req.body.is_active,
            req.params.id,
        ]);
        if (!result.rows.length)
            return res.status(404).json({ message: "Slide not found" });
        return res.json({ success: true, slide: result.rows[0] });
    }
    catch {
        return res.status(500).json({ message: "Failed to update slide" });
    }
};
exports.updateHomeSlide = updateHomeSlide;
const deleteHomeSlide = async (req, res) => {
    try {
        await db_1.pool.query("DELETE FROM home_slides WHERE id=$1", [req.params.id]);
        return res.json({ success: true });
    }
    catch {
        return res.status(500).json({ message: "Failed to delete slide" });
    }
};
exports.deleteHomeSlide = deleteHomeSlide;
