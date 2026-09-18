"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ticket_controller_1 = require("../controllers/ticket.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
router.get("/my", auth_1.verifyFirebaseToken, ticket_controller_1.getMyTickets);
router.post("/", auth_1.verifyFirebaseToken, ticket_controller_1.createTicket);
exports.default = router;
