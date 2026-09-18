export type LocalInvestmentKycCode = "approved" | "kyc_required" | "kyc_expired";

export type LocalInvestmentKycDecision = {
  approved: boolean;
  status: string;
  code: LocalInvestmentKycCode;
  message: string;
};

type LocalInvestmentKycInput = {
  aadhaarStatus: unknown;
  panStatus: unknown;
  currentStatus?: unknown;
  expiresAt?: Date | null;
  now?: number;
};

const normalized = (value: unknown) => String(value || "").trim().toLowerCase();

export const evaluateLocalInvestmentKyc = ({
  aadhaarStatus,
  panStatus,
  currentStatus,
  expiresAt,
  now = Date.now(),
}: LocalInvestmentKycInput): LocalInvestmentKycDecision => {
  const documentsApproved =
    normalized(aadhaarStatus) === "approved" && normalized(panStatus) === "approved";
  const expired = Boolean(expiresAt && expiresAt.getTime() <= now);

  if (expired) {
    return {
      approved: false,
      status: "expired",
      code: "kyc_expired",
      message: "Your KYC has expired. Complete KYC again before digital-gold transactions.",
    };
  }

  if (!documentsApproved) {
    return {
      approved: false,
      status: normalized(currentStatus) || "none",
      code: "kyc_required",
      message: "Complete Aadhaar and PAN KYC before buying or selling digital gold.",
    };
  }

  return {
    approved: true,
    status: "full",
    code: "approved",
    message: "Aadhaar and PAN KYC are verified for digital-gold transactions.",
  };
};
