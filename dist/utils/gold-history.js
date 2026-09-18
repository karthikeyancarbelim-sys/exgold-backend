"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goldHistoryDetails = void 0;
const provider_payload_1 = require("./provider-payload");
const augmont_merchant_policy_1 = require("./augmont-merchant-policy");
const goldHistoryDetails = (row) => {
    const details = row.details || {};
    const quantity = Number(row.gold_grams || 0);
    const totalAmount = (0, augmont_merchant_policy_1.roundMoney)(Number(row.amount || 0));
    const type = String(row.activity_type || "").toLowerCase();
    const isPurchase = ["buy", "sip"].includes(type);
    const explicitTaxRate = (0, provider_payload_1.readDeep)(details, ["taxRate", "tax_rate", "gstRate"]);
    const taxRate = !isPurchase ? 0 : Number(explicitTaxRate ?? process.env.AUGMONT_GOLD_TAX_RATE ?? 3);
    const explicitTaxAmount = (0, provider_payload_1.readDeep)(details, ["taxAmount", "tax_amount", "gstAmount"]);
    const taxAmount = !isPurchase ? 0 : Number(explicitTaxAmount ??
        (taxRate > 0 ? totalAmount - totalAmount / (1 + taxRate / 100) : 0));
    const taxableAmount = !isPurchase ? totalAmount : Number((0, provider_payload_1.readDeep)(details, ["preTaxAmount", "taxableAmount", "taxable_value"]) ?? Math.max(totalAmount - taxAmount, 0));
    const rate = Number((0, provider_payload_1.readDeep)(details, ["lockPrice", "lock_price", "rate", "buyRate", "sellRate"]) ??
        (quantity > 0 ? taxableAmount / quantity : 0));
    const providerId = row.provider_transaction_id ||
        (0, provider_payload_1.readDeep)(details, ["transactionId", "transaction_id", "txnId"]);
    return {
        ...row,
        metal_type: String((0, provider_payload_1.readDeep)(details, ["metalType", "metal_type"]) || "gold"),
        quantity: (0, augmont_merchant_policy_1.roundGold)(quantity),
        rate: (0, augmont_merchant_policy_1.roundMoney)(rate),
        taxable_amount: (0, augmont_merchant_policy_1.roundMoney)(taxableAmount),
        tax_rate: (0, augmont_merchant_policy_1.roundMoney)(taxRate),
        tax_amount: (0, augmont_merchant_policy_1.roundMoney)(taxAmount),
        total_amount: totalAmount,
        provider_transaction_id: providerId || row.reference_id,
        invoice_available: type === "buy" && Boolean(providerId) && quantity > 0 &&
            ["success", "completed", "complete", "confirmed", "approved"].includes(String(row.status).toLowerCase()),
    };
};
exports.goldHistoryDetails = goldHistoryDetails;
