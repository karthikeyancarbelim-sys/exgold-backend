"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDeepArray = exports.readDeep = exports.normalizeIfsc = exports.redactProviderPayload = exports.maskAccountNumber = exports.accountLast4 = void 0;
const accountDigits = (value) => String(value || "").replace(/\D+/g, "");
const accountLast4 = (value) => accountDigits(value).slice(-4);
exports.accountLast4 = accountLast4;
const maskAccountNumber = (value) => {
    const digits = accountDigits(value);
    if (!digits)
        return "";
    if (digits.length <= 4)
        return digits;
    return `${"*".repeat(Math.min(digits.length - 4, 8))}${digits.slice(-4)}`;
};
exports.maskAccountNumber = maskAccountNumber;
const redactProviderPayload = (value) => {
    if (Array.isArray(value))
        return value.map(exports.redactProviderPayload);
    if (!value || typeof value !== "object")
        return value;
    return Object.fromEntries(Object.entries(value).map(([key, next]) => {
        if (/account.?number/i.test(key))
            return [key, (0, exports.maskAccountNumber)(next)];
        if (/token|password|secret|authorization/i.test(key))
            return [key, "[REDACTED]"];
        return [key, (0, exports.redactProviderPayload)(next)];
    }));
};
exports.redactProviderPayload = redactProviderPayload;
const normalizeIfsc = (value) => String(value || "").replace(/\s+/g, "").toUpperCase();
exports.normalizeIfsc = normalizeIfsc;
const readDeep = (value, keys) => {
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = (0, exports.readDeep)(item, keys);
            if (found !== undefined && found !== null && found !== "")
                return found;
        }
        return undefined;
    }
    if (!value || typeof value !== "object")
        return undefined;
    for (const key of keys) {
        if (value[key] !== undefined && value[key] !== null && value[key] !== "") {
            return value[key];
        }
    }
    for (const nested of Object.values(value)) {
        if (nested && typeof nested === "object") {
            const found = (0, exports.readDeep)(nested, keys);
            if (found !== undefined && found !== null && found !== "")
                return found;
        }
    }
    return undefined;
};
exports.readDeep = readDeep;
const readDeepArray = (value, keys) => {
    const found = (0, exports.readDeep)(value, keys);
    if (Array.isArray(found))
        return found;
    if (found && typeof found === "object")
        return [found];
    return [];
};
exports.readDeepArray = readDeepArray;
