"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateLocalInvestmentKyc = void 0;
const normalized = (value) => String(value || "").trim().toLowerCase();
const evaluateLocalInvestmentKyc = ({ aadhaarStatus, panStatus, currentStatus, expiresAt, now = Date.now(), }) => {
    const documentsApproved = normalized(aadhaarStatus) === "approved" && normalized(panStatus) === "approved";
    const expired = Boolean(expiresAt && expiresAt.getTime() <= now);
    if (expired) {
        return {
            approved: false,
            status: "expired",
            code: "kyc_expired",
            message: "Your KYC has expired. Complete KYC again before digital-gold transactions.",
        };
    }
    if (!documentsApproved) {
        return {
            approved: false,
            status: normalized(currentStatus) || "none",
            code: "kyc_required",
            message: "Complete Aadhaar and PAN KYC before buying or selling digital gold.",
        };
    }
    return {
        approved: true,
        status: "full",
        code: "approved",
        message: "Aadhaar and PAN KYC are verified for digital-gold transactions.",
    };
};
exports.evaluateLocalInvestmentKyc = evaluateLocalInvestmentKyc;
