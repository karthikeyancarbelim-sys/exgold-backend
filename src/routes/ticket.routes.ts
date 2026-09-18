import express from "express";
import { createTicket, getMyTickets } from "../controllers/ticket.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

router.get("/my", verifyFirebaseToken, getMyTickets);
router.post("/", verifyFirebaseToken, createTicket);

export default router;
