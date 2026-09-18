const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const trimSlash = (value = "") => value.replace(/\/+$/, "");

const merchantId = process.env.AUGMONT_MERCHANT_ID;
const email = process.env.AUGMONT_EMAIL;
const password = process.env.AUGMONT_PASSWORD;
const merchantHeader = process.env.AUGMONT_MERCHANT_HEADER || "X-Merchant-Id";
const timeout = Number(process.env.AUGMONT_TIMEOUT_MS || 20000);

if (!merchantId || !email || !password) {
  console.error("Missing AUGMONT_MERCHANT_ID, AUGMONT_EMAIL, or AUGMONT_PASSWORD in .env");
  process.exit(1);
}

const configuredTestBaseUrls = (process.env.AUGMONT_TEST_BASE_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const baseUrls = [
  ...configuredTestBaseUrls,
  process.env.AUGMONT_BASE_URL,
  "https://uat-api.augmontgold.com/api/merchant/v1",
  "https://uat-api.augmontgold.com/api/merchant/v2",
  "https://uat-api.merchant.augmont.com/api/merchant/v1",
  "https://uat-api.merchant.augmont.com/api/merchant/v2",
]
  .filter(Boolean)
  .map(trimSlash)
  .filter((value, index, values) => values.indexOf(value) === index);

const extractDeep = (value, keys) => {
  if (!value || typeof value !== "object") return undefined;

  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }

  for (const nestedKey of ["data", "result", "response"]) {
    const nested = value[nestedKey];
    if (nested && typeof nested === "object") {
      const found = extractDeep(nested, keys);
      if (found !== undefined && found !== null) return found;
    }
  }

  return undefined;
};

const multipartPayload = (payload) => {
  const boundary = `----exgold-augmont-${Date.now()}`;
  const body =
    Object.entries(payload)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) =>
        [
          `--${boundary}`,
          `Content-Disposition: form-data; name="${key}"`,
          "",
          String(value),
        ].join("\r\n")
      )
      .join("\r\n") + `\r\n--${boundary}--\r\n`;

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
};

const run = async () => {
  const payload = { email, password };
  const tests = baseUrls.flatMap((baseUrl) => [
    { name: `${baseUrl} json`, url: `${baseUrl}/auth/login`, type: "json" },
    { name: `${baseUrl} multipart`, url: `${baseUrl}/auth/login`, type: "multipart" },
  ]);

  for (const test of tests) {
    try {
      const request =
        test.type === "json"
          ? {
              body: payload,
              headers: { "Content-Type": "application/json" },
            }
          : (() => {
              const form = multipartPayload(payload);
              return {
                body: form.body,
                headers: { "Content-Type": form.contentType },
              };
            })();

      const response = await axios.post(test.url, request.body, {
        timeout,
        headers: {
          Accept: "application/json",
          [merchantHeader]: merchantId,
          ...request.headers,
        },
        validateStatus: () => true,
      });

      const token = extractDeep(response.data, [
        "accessToken",
        "access_token",
        "token",
        "jwt",
        "jwtToken",
      ]);

      console.log(
        JSON.stringify({
          test: test.name,
          httpStatus: response.status,
          statusCode: response.data?.statusCode,
          message: response.data?.message || response.statusText,
          merchantId: extractDeep(response.data, ["merchantId", "merchant_id"]),
          tokenPresent: Boolean(token),
        })
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          test: test.name,
          error: error.code || error.message,
          message: error.message,
        })
      );
    }
  }
};

run();
