// ===============================
// services/augmont.service.ts
// ===============================
import axios from "axios";

const BASE_URL = process.env.AUGMONT_BASE_URL!;
const API_KEY = process.env.AUGMONT_API_KEY!;
const SECRET = process.env.AUGMONT_SECRET!;

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
    "x-api-secret": SECRET,
  },
});

export const augmontGetRates = async () => {
  const res = await client.get("/rates");
  return res.data;
};

export const augmontBuyGold = async (data: {
  userId: string;
  amount: number;
}) => {
  const res = await client.post("/buy", data);
  return res.data;
};

export const augmontSellGold = async (data: {
  userId: string;
  grams: number;
}) => {
  const res = await client.post("/sell", data);
  return res.data;
};

export const augmontGetBalance = async (userId: string) => {
  const res = await client.get(`/balance/${userId}`);
  return res.data;
};