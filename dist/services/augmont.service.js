"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.augmontGetBalance = exports.augmontSellGold = exports.augmontBuyGold = exports.augmontGetRates = void 0;
// ===============================
// services/augmont.service.ts
// ===============================
const axios_1 = __importDefault(require("axios"));
const BASE_URL = process.env.AUGMONT_BASE_URL;
const API_KEY = process.env.AUGMONT_API_KEY;
const SECRET = process.env.AUGMONT_SECRET;
const client = axios_1.default.create({
    baseURL: BASE_URL,
    headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "x-api-secret": SECRET,
    },
});
const augmontGetRates = async () => {
    const res = await client.get("/rates");
    return res.data;
};
exports.augmontGetRates = augmontGetRates;
const augmontBuyGold = async (data) => {
    const res = await client.post("/buy", data);
    return res.data;
};
exports.augmontBuyGold = augmontBuyGold;
const augmontSellGold = async (data) => {
    const res = await client.post("/sell", data);
    return res.data;
};
exports.augmontSellGold = augmontSellGold;
const augmontGetBalance = async (userId) => {
    const res = await client.get(`/balance/${userId}`);
    return res.data;
};
exports.augmontGetBalance = augmontGetBalance;
