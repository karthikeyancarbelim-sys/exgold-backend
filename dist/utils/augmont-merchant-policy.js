"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSellQuantity = exports.validateBuyAmount = exports.hasPrecision = exports.roundGold = exports.roundMoney = exports.indiaFinancialYearStart = exports.augmontMerchantPolicy = exports.policyNumber = void 0;
const policyNumber = (raw, fallback, minimum, maximum) => {
    const value = Number(raw);
    return raw?.trim() && Number.isFinite(value) && value >= minimum && value <= maximum
        ? value
        : fallback;
};
exports.policyNumber = policyNumber;
exports.augmontMerchantPolicy = Object.freeze({
    minimumBuyAmount: (0, exports.policyNumber)(process.env.MIN_DIGITAL_GOLD_PURCHASE_AMOUNT, 5, 5, 5000000),
    maximumBuyAmount: (0, exports.policyNumber)(process.env.MAX_DIGITAL_GOLD_PURCHASE_AMOUNT, 5000000, 5, 5000000),
    maximumSellAmount: (0, exports.policyNumber)(process.env.MAX_DIGITAL_GOLD_SELL_AMOUNT, 1000000, 0.01, 1000000),
    kycFinancialYearThreshold: (0, exports.policyNumber)(process.env.DIGITAL_GOLD_KYC_THRESHOLD, 180000, 0, 180000),
    sellLockHours: (0, exports.policyNumber)(process.env.DIGITAL_GOLD_SELL_LOCK_HOURS, 48, 48, 8760),
    maximumBankIds: Math.floor((0, exports.policyNumber)(process.env.AUGMONT_MAX_BANK_IDS, 3, 1, 3)),
    maximumBankModifications: Math.floor((0, exports.policyNumber)(process.env.AUGMONT_MAX_BANK_MODIFICATIONS, 3, 1, 3)),
    rateRefreshSeconds: 60,
    rateValidityMinutes: 15,
});
const indiaFinancialYearStart = (now = new Date()) => {
    const indiaOffsetMs = 330 * 60 * 1000;
    const indiaNow = new Date(now.getTime() + indiaOffsetMs);
    const year = indiaNow.getUTCFullYear();
    const month = indiaNow.getUTCMonth() + 1;
    return new Date(Date.UTC(month >= 4 ? year : year - 1, 3, 1) - indiaOffsetMs);
};
exports.indiaFinancialYearStart = indiaFinancialYearStart;
const roundDecimal = (value, places) => {
    if (!Number.isFinite(value))
        throw new Error("Invalid financial value");
    // Decimal shifting avoids binary half-cent errors such as 1.005 -> 1.00.
    const [coefficient, exponent = "0"] = Math.abs(value).toString().split("e");
    const shifted = Number(`${coefficient}e${Number(exponent) + places}`);
    return Math.sign(value) * Number(`${Math.round(shifted)}e-${places}`);
};
const roundMoney = (value) => roundDecimal(value, 2);
exports.roundMoney = roundMoney;
const roundGold = (value) => roundDecimal(value, 4);
exports.roundGold = roundGold;
const hasPrecision = (value, decimals) => Number.isFinite(value) && Math.abs(value - Number(value.toFixed(decimals))) < 1e-9;
exports.hasPrecision = hasPrecision;
const validateBuyAmount = (amount) => {
    if (!(0, exports.hasPrecision)(amount, 2))
        return "Enter an amount with at most two decimal places";
    if (amount < exports.augmontMerchantPolicy.minimumBuyAmount) {
        return `Minimum digital gold purchase is Rs.${exports.augmontMerchantPolicy.minimumBuyAmount}`;
    }
    if (amount > exports.augmontMerchantPolicy.maximumBuyAmount) {
        return `Maximum digital gold purchase is Rs.${exports.augmontMerchantPolicy.maximumBuyAmount}`;
    }
    return null;
};
exports.validateBuyAmount = validateBuyAmount;
const validateSellQuantity = (quantity) => !(0, exports.hasPrecision)(quantity, 4) || quantity <= 0
    ? "Enter a positive gold quantity with at most four decimal places"
    : null;
exports.validateSellQuantity = validateSellQuantity;
