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

const docPaths = [
  "/",
  "/docs",
  "/api-docs",
  "/documentation",
  "/swagger",
  "/swagger.json",
  "/openapi.json",
  "/postman",
  "/postman.json",
  "/collection",
  "/collection.json",
];

const apiPaths = [
  "/user-address",
  "/user-address/",
  "/user/address",
  "/user/address/",
  "/user-kyc-det",
  "/user-kyc-det/",
  "/user-kyc-detail",
  "/user-kyc-details",
  "/user-kyc-data",
  "/user/kyc-detail",
  "/user/kyc-details",
  "/order-list",
  "/order-list/",
  "/order/list",
  "/orders",
  "/orders/list",
  "/balance",
  "/balance/EXG_PROBE",
];

const probe = async (token, method, url, data) => {
  try {
    const response = await axios.request({
      method,
      url,
      data,
      timeout,
      validateStatus: () => true,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [merchantHeader]: merchantId,
        Authorization: `Bearer ${token}`,
      },
    });
    const body = response.data;
    const text = typeof body === "string" ? body.slice(0, 120) : "";
    return {
      httpStatus: response.status,
      statusCode: body && body.statusCode,
      message: body && body.message ? body.message : text,
      keys: body && typeof body === "object" ? Object.keys(body).slice(0, 8) : [],
    };
  } catch (error) {
    return { error: error.code || error.message };
  }
};

const run = async () => {
  const token = await login();
  if (!token) throw new Error("Login did not return token");

  for (const path of docPaths) {
    const result = await probe(token, "GET", `${baseUrl}${path}`, undefined);
    console.log(JSON.stringify({ kind: "docs", method: "GET", path, ...result }));
  }

  const probeUser = {
    uniqueId: `EXG_PROBE_${Date.now()}`,
    userId: `EXG_PROBE_${Date.now()}`,
  };

  for (const path of apiPaths) {
    for (const method of ["GET", "POST"]) {
      const payload = method === "POST" ? probeUser : undefined;
      const result = await probe(token, method, `${baseUrl}${path}`, payload);
      console.log(JSON.stringify({ kind: "api", method, path, ...result }));
    }
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
