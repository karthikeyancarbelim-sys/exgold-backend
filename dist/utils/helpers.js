"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateGoldPrice = exports.generateReferralCode = void 0;
// ===============================
// utils/helpers.ts
// ===============================
const generateReferralCode = () => {
    return ("EXG" +
        Math.random().toString(36).substring(2, 8).toUpperCase());
};
exports.generateReferralCode = generateReferralCode;
const calculateGoldPrice = (grams, rate, purity, wastage) => {
    const factor = purity === 24 ? 1 : purity === 22 ? 22 / 24 : 18 / 24;
    const base = grams * rate * factor;
    const waste = base * (wastage / 100);
    return Math.round(base + waste);
};
exports.calculateGoldPrice = calculateGoldPrice;
