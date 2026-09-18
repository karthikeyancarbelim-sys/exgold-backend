"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteTicket = exports.updateTicket = exports.createAdminTicket = exports.getAllTickets = exports.getMyTickets = exports.createTicket = void 0;
const db_1 = require("../config/db");
const createTicket = async (req, res) => {
    try {
        const userResult = await db_1.pool.query("SELECT id FROM users WHERE firebase_uid=$1", [req.user.uid]);
        const user = userResult.rows[0];
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const result = await db_1.pool.query(`INSERT INTO support_tickets (user_id, subject, message, category, priority)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`, [
            user.id,
            req.body.subject || "Support request",
            req.body.message || "",
            req.body.category || "general",
            req.body.priority || "normal",
        ]);
        return res.status(201).json({ success: true, ticket: result.rows[0] });
    }
    catch (error) {
        return res.status(500).json({ message: "Failed to create ticket" });
    }
};
exports.createTicket = createTicket;
const getMyTickets = async (req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT * FROM support_tickets
       WHERE user_id=(SELECT id FROM users WHERE firebase_uid=$1)
       ORDER BY created_at DESC`, [req.user.uid]);
        return res.json(result.rows);
    }
    catch {
        return res.status(500).json({ message: "Failed to fetch tickets" });
    }
};
exports.getMyTickets = getMyTickets;
const getAllTickets = async (_req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT t.*, u.name, u.phone
       FROM support_tickets t
       LEFT JOIN users u ON u.id=t.user_id
       ORDER BY t.updated_at DESC`);
        return res.json(result.rows);
    }
    catch {
        return res.status(500).json({ message: "Failed to fetch tickets" });
    }
};
exports.getAllTickets = getAllTickets;
const createAdminTicket = async (req, res) => {
    try {
        const userId = req.body.userId || req.body.user_id || null;
        const result = await db_1.pool.query(`INSERT INTO support_tickets
       (user_id, subject, message, category, priority, status, assigned_to, admin_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`, [
            userId,
            req.body.subject || "Internal support ticket",
            req.body.message || "",
            req.body.category || "admin",
            req.body.priority || "normal",
            req.body.status || "open",
            req.body.assignedTo || req.body.assigned_to || null,
            req.body.adminNotes || req.body.admin_notes || null,
        ]);
        return res.status(201).json({ success: true, ticket: result.rows[0] });
    }
    catch {
        return res.status(500).json({ message: "Failed to create ticket" });
    }
};
exports.createAdminTicket = createAdminTicket;
const updateTicket = async (req, res) => {
    try {
        const result = await db_1.pool.query(`UPDATE support_tickets
       SET subject=COALESCE($1, subject),
           message=COALESCE($2, message),
           category=COALESCE($3, category),
           priority=COALESCE($4, priority),
           status=COALESCE($5, status),
           assigned_to=COALESCE($6, assigned_to),
           admin_notes=COALESCE($7, admin_notes),
           updated_at=NOW()
       WHERE id=$8
       RETURNING *`, [
            req.body.subject,
            req.body.message,
            req.body.category,
            req.body.priority,
            req.body.status,
            req.body.assignedTo || req.body.assigned_to,
            req.body.adminNotes || req.body.admin_notes,
            req.params.id,
        ]);
        if (!result.rows.length)
            return res.status(404).json({ message: "Ticket not found" });
        return res.json({ success: true, ticket: result.rows[0] });
    }
    catch {
        return res.status(500).json({ message: "Failed to update ticket" });
    }
};
exports.updateTicket = updateTicket;
const deleteTicket = async (req, res) => {
    try {
        await db_1.pool.query("DELETE FROM support_tickets WHERE id=$1", [req.params.id]);
        return res.json({ success: true });
    }
    catch {
        return res.status(500).json({ message: "Failed to delete ticket" });
    }
};
exports.deleteTicket = deleteTicket;
