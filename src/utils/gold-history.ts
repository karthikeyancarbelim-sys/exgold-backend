import { readDeep } from "./provider-payload";
import { roundGold, roundMoney } from "./augmont-merchant-policy";

export const goldHistoryDetails = (row: any) => {
  const details = row.details || {};
  const quantity = Number(row.gold_grams || 0);
  const totalAmount = roundMoney(Number(row.amount || 0));
  const type = String(row.activity_type || "").toLowerCase();
  const isPurchase = ["buy", "sip"].includes(type);
  const explicitTaxRate = readDeep(details, ["taxRate", "tax_rate", "gstRate"]);
  const taxRate = !isPurchase ? 0 : Number(explicitTaxRate ?? process.env.AUGMONT_GOLD_TAX_RATE ?? 3);
  const explicitTaxAmount = readDeep(details, ["taxAmount", "tax_amount", "gstAmount"]);
  const taxAmount = !isPurchase ? 0 : Number(explicitTaxAmount ??
    (taxRate > 0 ? totalAmount - totalAmount / (1 + taxRate / 100) : 0));
  const taxableAmount = !isPurchase ? totalAmount : Number(
    readDeep(details, ["preTaxAmount", "taxableAmount", "taxable_value"]) ?? Math.max(totalAmount - taxAmount, 0),
  );
  const rate = Number(readDeep(details, ["lockPrice", "lock_price", "rate", "buyRate", "sellRate"]) ??
    (quantity > 0 ? taxableAmount / quantity : 0));
  const providerId = row.provider_transaction_id ||
    readDeep(details, ["transactionId", "transaction_id", "txnId"]);
  return {
    ...row,
    metal_type: String(readDeep(details, ["metalType", "metal_type"]) || "gold"),
    quantity: roundGold(quantity),
    rate: roundMoney(rate),
    taxable_amount: roundMoney(taxableAmount),
    tax_rate: roundMoney(taxRate),
    tax_amount: roundMoney(taxAmount),
    total_amount: totalAmount,
    provider_transaction_id: providerId || row.reference_id,
    invoice_available: type === "buy" && Boolean(providerId) && quantity > 0 &&
      ["success", "completed", "complete", "confirmed", "approved"].includes(String(row.status).toLowerCase()),
  };
};
