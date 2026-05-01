"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createKycRequest = void 0;
const axios_1 = __importDefault(require("axios"));
const PROVIDER = process.env.KYC_PROVIDER || "digio";
const createKycRequest = async (user) => {
    if (PROVIDER === "digio") {
        return digioKyc(user);
    }
    throw new Error("KYC provider not configured");
};
exports.createKycRequest = createKycRequest;
const digioKyc = async (user) => {
    const response = await axios_1.default.post("https://api.digio.in/client/kyc/v2/request", {
        customer_identifier: user.id,
        customer_name: user.name,
        template_name: "KYC_TEMPLATE",
    }, {
        auth: {
            username: process.env.DIGIO_CLIENT_ID,
            password: process.env.DIGIO_CLIENT_SECRET,
        },
    });
    return response.data;
};
