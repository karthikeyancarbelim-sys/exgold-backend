import { Request, Response } from "express";
import { pool } from "../config/db";
import { AuthRequest } from "../middleware/auth";

const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

const getUserByUid = async (uid: string) => {
  const result = await pool.query(
    "SELECT id, firebase_uid, name, phone FROM users WHERE firebase_uid=$1",
    [uid]
  );
  return result.rows[0];
};

export const createConversation = async (req: AuthRequest, res: Response) => {
  try {
    const currentUid = req.user.uid;
    const otherUid = String(req.body.otherUserId || req.body.otherUid || "");
    const adId = String(req.body.adId || "general");
    if (!otherUid) return res.status(400).json({ message: "otherUserId is required" });

    const [currentUser, otherUserResult] = await Promise.all([
      getUserByUid(currentUid),
      getUserByUid(otherUid),
    ]);

    const otherUser = otherUserResult || {
      firebase_uid: otherUid,
      name: req.body.otherUserName || "Seller",
    };

    const sorted = [currentUid, otherUid].sort();
    const conversationId = `${safeId(adId)}_${safeId(sorted[0])}_${safeId(sorted[1])}`;
    const currentName = currentUser?.name || req.user.name || "User";
    const otherName = otherUser?.name || "Seller";

    await pool.query(
      `INSERT INTO chat_conversations
       (id, ad_id, buyer_uid, seller_uid, buyer_name, seller_name)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET updated_at=NOW()
       RETURNING *`,
      [conversationId, adId, currentUid, otherUid, currentName, otherName]
    );

    return res.status(201).json({ success: true, conversationId });
  } catch (error) {
    console.error("CREATE CONVERSATION ERROR:", error);
    return res.status(500).json({ message: "Failed to create conversation" });
  }
};

export const getMyConversations = async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM chat_conversations
       WHERE buyer_uid=$1 OR seller_uid=$1
       ORDER BY last_message_at DESC`,
      [req.user.uid]
    );
    return res.json(result.rows);
  } catch {
    return res.status(500).json({ message: "Failed to fetch conversations" });
  }
};

export const getConversationMessages = async (req: AuthRequest, res: Response) => {
  try {
    const allowed = await pool.query(
      `SELECT id FROM chat_conversations
       WHERE id=$1 AND (buyer_uid=$2 OR seller_uid=$2)`,
      [req.params.id, req.user.uid]
    );
    if (!allowed.rows.length) return res.status(404).json({ message: "Conversation not found" });

    const result = await pool.query(
      `SELECT * FROM chat_messages
       WHERE conversation_id=$1
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    return res.json(result.rows);
  } catch {
    return res.status(500).json({ message: "Failed to fetch messages" });
  }
};

export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const text = String(req.body.text || "").trim();
    const type = String(req.body.type || "text");
    const amount = req.body.amount ? Number(req.body.amount) : null;
    if (!text && type === "text") return res.status(400).json({ message: "Message cannot be empty" });

    const conversation = await pool.query(
      `SELECT * FROM chat_conversations
       WHERE id=$1 AND (buyer_uid=$2 OR seller_uid=$2)`,
      [req.params.id, req.user.uid]
    );
    const row = conversation.rows[0];
    if (!row) return res.status(404).json({ message: "Conversation not found" });

    const receiverUid = row.buyer_uid === req.user.uid ? row.seller_uid : row.buyer_uid;
    const message = await pool.query(
      `INSERT INTO chat_messages
       (conversation_id, sender_uid, receiver_uid, type, text, amount)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [req.params.id, req.user.uid, receiverUid, type, text, amount]
    );

    await pool.query(
      `UPDATE chat_conversations
       SET last_message=$1, last_message_at=NOW(), updated_at=NOW()
       WHERE id=$2`,
      [type === "offer" ? `Offer: Rs.${amount || 0}` : text, req.params.id]
    );

    return res.status(201).json({ success: true, message: message.rows[0] });
  } catch (error) {
    console.error("SEND MESSAGE ERROR:", error);
    return res.status(500).json({ message: "Failed to send message" });
  }
};

export const getAllConversations = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM chat_messages m WHERE m.conversation_id=c.id) AS message_count
       FROM chat_conversations c
       ORDER BY c.last_message_at DESC`
    );
    return res.json(result.rows);
  } catch {
    return res.status(500).json({ message: "Failed to fetch conversations" });
  }
};

export const getAdminConversationMessages = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM chat_messages
       WHERE conversation_id=$1
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    return res.json(result.rows);
  } catch {
    return res.status(500).json({ message: "Failed to fetch messages" });
  }
};

export const updateConversationStatus = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE chat_conversations
       SET status=COALESCE($1,status), updated_at=NOW()
       WHERE id=$2
       RETURNING *`,
      [req.body.status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: "Conversation not found" });
    return res.json({ success: true, conversation: result.rows[0] });
  } catch {
    return res.status(500).json({ message: "Failed to update conversation" });
  }
};
