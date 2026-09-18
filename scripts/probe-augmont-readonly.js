const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const baseUrl = String(process.env.AUGMONT_BASE_URL || "").replace(/\/+$/, "");
const merchantHeader = process.env.AUGMONT_MERCHANT_HEADER || "X-Merchant-Id";
const merchantId = process.env.AUGMONT_MERCHANT_ID;
const timeout = Number(process.env.AUGMONT_TIMEOUT_MS || 20000);

const extractDeep = (value, keys) => {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  for (const nestedKey of ["data", "result", "response"]) {
    const found = extractDeep(value[nestedKey], keys);
    if (found !== undefined && found !== null) return found;
  }
  return undefined;
};

const login = async () => {
  const response = await axios.post(
    `${baseUrl}/auth/login`,
    {
      email: process.env.AUGMONT_EMAIL,
      password: process.env.AUGMONT_PASSWORD,
    },
    {
      timeout,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [merchantHeader]: merchantId,
      },
    }
  );
  return extractDeep(response.data, ["accessToken", "access_token", "token", "jwt", "jwtToken"]);
};

const paths = [
  process.env.AUGMONT_RATES_PATH || "/rates",
  "/rate",
  "/rates/gold",
  "/master/rates",
  "/products",
  "/product",
  "/products/list",
  process.env.AUGMONT_ORDER_LIST_PATH || "/order-list",
  "/orders",
  "/orders/list",
  "/user-address",
  "/user/address",
  "/user-kyc-details",
  "/user-kyc-detail",
  "/user-kyc-det",
  "/user/kyc-details",
];

const run = async () => {
  if (!baseUrl) throw new Error("Missing AUGMONT_BASE_URL");
  const token = await login();
  if (!token) throw new Error("Login did not return an access token");

  for (const path of [...new Set(paths)]) {
    try {
      const response = await axios.get(`${baseUrl}${path}`, {
        timeout,
        validateStatus: () => true,
        headers: {
          Accept: "application/json",
          [merchantHeader]: merchantId,
          Authorization: `Bearer ${token}`,
        },
      });
      const data = response.data;
      console.log(
        JSON.stringify({
          path,
          httpStatus: response.status,
          statusCode: data && data.statusCode,
          message: data && data.message,
          keys: data && typeof data === "object" ? Object.keys(data).slice(0, 10) : [],
        })
      );
    } catch (error) {
      console.log(JSON.stringify({ path, error: error.code || error.message }));
    }
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
