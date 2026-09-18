require("dotenv").config();

const { augmontGetProducts } = require("../dist/services/augmont.service");

const rowsFrom = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["data", "result", "products", "list", "records"]) {
    const rows = rowsFrom(value[key]);
    if (rows.length) return rows;
  }
  return [];
};

const categoryOf = (product) =>
  String(product.jewelleryType || product.category || "products").trim().toLowerCase() ||
  "products";

(async () => {
  const rows = [];

  for (let page = 1; page <= 20; page += 1) {
    const payload = await augmontGetProducts({ page, count: 30 });
    const pageRows = rowsFrom(payload);
    rows.push(...pageRows);

    const pagination = payload?.result?.pagination || payload?.pagination;
    const hasMore = pagination?.hasMore === true || pagination?.has_more === true;
    if (!hasMore || pageRows.length === 0) break;
  }

  const goldCoins = rows.filter((product) => {
    const text = `${product.name || ""} ${product.sku || ""} ${product.jewelleryType || ""} ${product.metalType || ""}`.toLowerCase();
    return String(product.metalType || "").toLowerCase() === "gold" &&
      (text.includes("gold coin") ||
        ["coin", "coins"].includes(String(product.jewelleryType || "").toLowerCase()) ||
        String(product.sku || "").toUpperCase().includes("GC"));
  });
  const categories = rows.reduce((acc, product) => {
    const category = categoryOf(product);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

  console.log("catalog_count", rows.length);
  console.log("gold_coin_count", goldCoins.length);
  console.log("categories", categories);
})().catch((error) => {
  console.error("catalog_check_error", error.message);
  process.exit(1);
});
