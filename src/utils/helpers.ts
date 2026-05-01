// ===============================
// utils/helpers.ts
// ===============================
export const generateReferralCode = () => {
  return (
    "EXG" +
    Math.random().toString(36).substring(2, 8).toUpperCase()
  );
};

export const calculateGoldPrice = (
  grams: number,
  rate: number,
  purity: number,
  wastage: number
) => {
  const factor = purity === 24 ? 1 : purity === 22 ? 22 / 24 : 18 / 24;

  const base = grams * rate * factor;
  const waste = base * (wastage / 100);

  return Math.round(base + waste);
};