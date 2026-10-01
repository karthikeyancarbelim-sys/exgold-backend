const nonLiveHostPattern = /(^|[./_-])(uat|sandbox|test)([./_:-]|$)/i;

export type AugmontMoneySafety = {
  safe: boolean;
  environment: "live" | "non_live" | "unknown";
  paymentEnvironment: "live" | "test" | "unknown";
  code:
    | "AUGMONT_LIVE_REQUIRED"
    | "PAYMENT_PROVIDER_ENVIRONMENT_MISMATCH"
    | "AUGMONT_UAT_TRANSACTIONS_DISABLED"
    | null;
  message: string | null;
};

export type AugmontDirectPayoutSafety = Omit<AugmontMoneySafety, "code"> & {
  payoutMode: "direct_customer" | "unknown";
  code: AugmontMoneySafety["code"] | "AUGMONT_DIRECT_PAYOUT_REQUIRED";
};

export const getAugmontMoneySafety = (): AugmontMoneySafety => {
  const razorpayKeyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const paymentEnvironment = razorpayKeyId.startsWith("rzp_live_")
    ? "live"
    : razorpayKeyId.startsWith("rzp_test_")
      ? "test"
      : "unknown";
  const production = String(process.env.NODE_ENV || "").toLowerCase() === "production";

  if (!production) {
    return {
      safe: true,
      environment: "non_live",
      paymentEnvironment,
      code: null,
      message: null,
    };
  }

  const configuredEnvironment = String(
    process.env.AUGMONT_ENVIRONMENT || ""
  ).trim().toLowerCase();
  const endpoints = [
    process.env.AUGMONT_API_ROOT,
    process.env.AUGMONT_BASE_URL,
    process.env.AUGMONT_LOGIN_BASE_URL,
  ].filter(Boolean) as string[];
  const endpointIsNonLive = endpoints.some((value) => nonLiveHostPattern.test(value));
  const explicitlyLive = ["live", "production"].includes(configuredEnvironment);
  const providerEnvironment = endpointIsNonLive
    ? "non_live"
    : explicitlyLive && endpoints.length > 0
      ? "live"
      : "unknown";
  const uatTransactionsEnabled =
    String(process.env.AUGMONT_UAT_TRANSACTIONS_ENABLED || "").toLowerCase() === "true";
  const livePair = providerEnvironment === "live" && paymentEnvironment === "live";
  const testPair = providerEnvironment === "non_live" &&
    paymentEnvironment === "test" &&
    uatTransactionsEnabled;
  const safe = livePair || testPair;

  let code: AugmontMoneySafety["code"] = null;
  let message: string | null = null;
  if (!safe) {
    if (
      (providerEnvironment === "non_live" && paymentEnvironment === "live") ||
      (providerEnvironment === "live" && paymentEnvironment === "test")
    ) {
      code = "PAYMENT_PROVIDER_ENVIRONMENT_MISMATCH";
      message = "Digital-gold checkout is paused because payment and gold provider environments do not match. No payment was created.";
    } else if (providerEnvironment === "non_live" && paymentEnvironment === "test") {
      code = "AUGMONT_UAT_TRANSACTIONS_DISABLED";
      message = "Digital-gold UAT checkout is not enabled on this server. No payment was created.";
    } else {
      code = "AUGMONT_LIVE_REQUIRED";
      message = "Gold transactions are temporarily paused while the live provider settlement account is configured. No payment was created.";
    }
  }

  return {
    safe,
    environment: providerEnvironment,
    paymentEnvironment,
    code,
    message,
  };
};

export const getAugmontDirectPayoutSafety = (): AugmontDirectPayoutSafety => {
  const provider = getAugmontMoneySafety();
  const configuredMode = String(process.env.AUGMONT_SELL_PAYOUT_MODE || "")
    .trim()
    .toLowerCase();
  const directCustomer = configuredMode === "direct_customer";
  const production = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const safe = provider.safe && (!production || directCustomer);

  return {
    ...provider,
    safe,
    payoutMode: directCustomer ? "direct_customer" : "unknown",
    code: safe
      ? null
      : provider.code || "AUGMONT_DIRECT_PAYOUT_REQUIRED",
    message: safe
      ? null
      : provider.message ||
        "Gold selling is paused until Augmont direct-to-customer bank payout is configured.",
  };
};
