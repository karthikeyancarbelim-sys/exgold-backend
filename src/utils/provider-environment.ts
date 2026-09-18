const nonLiveHostPattern = /(^|[./_-])(uat|sandbox|test)([./_:-]|$)/i;

export type AugmontMoneySafety = {
  safe: boolean;
  environment: "live" | "non_live" | "unknown";
  code: "AUGMONT_LIVE_REQUIRED" | null;
  message: string | null;
};

export type AugmontDirectPayoutSafety = Omit<AugmontMoneySafety, "code"> & {
  payoutMode: "direct_customer" | "unknown";
  code: "AUGMONT_LIVE_REQUIRED" | "AUGMONT_DIRECT_PAYOUT_REQUIRED" | null;
};

export const getAugmontMoneySafety = (): AugmontMoneySafety => {
  if (String(process.env.NODE_ENV || "").toLowerCase() !== "production") {
    return {
      safe: true,
      environment: "non_live",
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
  const safe = explicitlyLive && endpoints.length > 0 && !endpointIsNonLive;

  return {
    safe,
    environment: endpointIsNonLive
      ? "non_live"
      : explicitlyLive
        ? "live"
        : "unknown",
    code: safe ? null : "AUGMONT_LIVE_REQUIRED",
    message: safe
      ? null
      : "Gold transactions are temporarily paused while the live provider settlement account is configured. No payment was created.",
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
