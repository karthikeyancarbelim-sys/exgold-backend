export const policyNumber = (raw: string | undefined, fallback: number, minimum: number, maximum: number) => {
  const value = Number(raw);
  return raw?.trim() && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
};

export const augmontMerchantPolicy = Object.freeze({
  minimumBuyAmount: policyNumber(process.env.MIN_DIGITAL_GOLD_PURCHASE_AMOUNT, 5, 5, 5_000_000),
  maximumBuyAmount: policyNumber(process.env.MAX_DIGITAL_GOLD_PURCHASE_AMOUNT, 5_000_000, 5, 5_000_000),
  maximumSellAmount: policyNumber(process.env.MAX_DIGITAL_GOLD_SELL_AMOUNT, 1_000_000, 0.01, 1_000_000),
  kycFinancialYearThreshold: policyNumber(process.env.DIGITAL_GOLD_KYC_THRESHOLD, 180_000, 0, 180_000),
  sellLockHours: policyNumber(process.env.DIGITAL_GOLD_SELL_LOCK_HOURS, 48, 48, 8760),
  maximumBankIds: Math.floor(policyNumber(process.env.AUGMONT_MAX_BANK_IDS, 3, 1, 3)),
  maximumBankModifications: Math.floor(policyNumber(process.env.AUGMONT_MAX_BANK_MODIFICATIONS, 3, 1, 3)),
  rateRefreshSeconds: 60,
  rateValidityMinutes: 15,
});

export const indiaFinancialYearStart = (now = new Date()) => {
  const indiaOffsetMs = 330 * 60 * 1000;
  const indiaNow = new Date(now.getTime() + indiaOffsetMs);
  const year = indiaNow.getUTCFullYear();
  const month = indiaNow.getUTCMonth() + 1;
  return new Date(Date.UTC(month >= 4 ? year : year - 1, 3, 1) - indiaOffsetMs);
};

const roundDecimal = (value: number, places: number) => {
  if (!Number.isFinite(value)) throw new Error("Invalid financial value");
  // Decimal shifting avoids binary half-cent errors such as 1.005 -> 1.00.
  const [coefficient, exponent = "0"] = Math.abs(value).toString().split("e");
  const shifted = Number(`${coefficient}e${Number(exponent) + places}`);
  return Math.sign(value) * Number(`${Math.round(shifted)}e-${places}`);
};
export const roundMoney = (value: number) => roundDecimal(value, 2);
export const roundGold = (value: number) => roundDecimal(value, 4);

export const hasPrecision = (value: number, decimals: number) =>
  Number.isFinite(value) && Math.abs(value - Number(value.toFixed(decimals))) < 1e-9;

export const validateBuyAmount = (amount: number) => {
  if (!hasPrecision(amount, 2)) return "Enter an amount with at most two decimal places";
  if (amount < augmontMerchantPolicy.minimumBuyAmount) {
    return `Minimum digital gold purchase is Rs.${augmontMerchantPolicy.minimumBuyAmount}`;
  }
  if (amount > augmontMerchantPolicy.maximumBuyAmount) {
    return `Maximum digital gold purchase is Rs.${augmontMerchantPolicy.maximumBuyAmount}`;
  }
  return null;
};

export const validateSellQuantity = (quantity: number) =>
  !hasPrecision(quantity, 4) || quantity <= 0
    ? "Enter a positive gold quantity with at most four decimal places"
    : null;
