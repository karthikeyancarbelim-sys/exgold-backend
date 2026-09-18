import axios from "axios";

const KYCAID_BASE_URL = "https://api.kycaid.com";

export type KycStep = "aadhaar" | "pan" | "video" | "full";

const nerotixHeaders = () => {
  const token = process.env.NEROTIX_API_TOKEN?.trim();
  if (!token) {
    throw new Error("NEROTIX_API_TOKEN is required");
  }

  const authHeader = (process.env.NEROTIX_AUTH_HEADER || "Authorization").trim();
  const authScheme = (process.env.NEROTIX_AUTH_SCHEME || "Bearer").trim();
  const authorizationValue = authScheme ? `${authScheme} ${token}` : token;

  return {
    [authHeader]: authorizationValue,
    "Content-Type": "application/json",
  };
};

export const createKycRequest = async (user: any) => {
  if ((process.env.KYC_PROVIDER || "kycaid").toLowerCase() === "nerotix") {
    return nerotixHostedOrSession(user);
  }

  return kycaidHostedForm(user);
};

const nerotixHostedOrSession = async (user: any) => {
  const createSessionUrl =
    process.env.NEROTIX_CREATE_SESSION_URL ||
    "https://api.nerofy.in/api/v1/service/digilocker/verify";

  const response = await axios.post(
    createSessionUrl,
    {
      document_requested: ["AADHAAR"],
      user_flow: process.env.NEROTIX_USER_FLOW || "signup",
    },
    {
      headers: nerotixHeaders(),
    }
  );

  const data = response.data?.data || {};

  return {
    provider: "nerotix",
    id: data.txn_id || response.data?.txn_id,
    reference_id:
      data.reference_id ||
      data.ref_id ||
      response.data?.reference_id ||
      response.data?.ref_id,
    url: data.url || response.data?.url,
    verificationUrl: data.url || response.data?.url,
    ...response.data,
  };
};

export const getNerotixDigilockerData = async (kyc: any) => {
  const url =
    process.env.NEROTIX_DIGILOCKER_GET_DATA_URL ||
    "https://api.nerofy.in/api/v1/service/digilocker/get-data";

  const refId =
    kyc.nerotix_reference_id ||
    kyc.reference_id ||
    kyc.aadhaar_reference_id ||
    kyc.video_reference_id;
  const txnId =
    kyc.aadhaar_txn_id ||
    kyc.nerotix_txn_id ||
    kyc.video_reference_id ||
    kyc.reference_id;

  if (!refId || !txnId) return null;

  const body = {
    ref_id: refId,
    txn_id: txnId,
    document_type: "AADHAAR",
  };

  try {
    const response = await axios.post(url, body, { headers: nerotixHeaders() });
    return response.data;
  } catch (error: any) {
    const configuredUrl = Boolean(process.env.NEROTIX_DIGILOCKER_GET_DATA_URL?.trim());
    const status = Number(error?.response?.status || 0);
    const message = String(error?.response?.data?.message || "").toLowerCase();
    const routeMissing =
      status === 404 ||
      message.includes("route not found") ||
      message.includes("cannot post");

    if (configuredUrl || !routeMissing || !url.endsWith("/digilocker/get-data")) {
      throw error;
    }

    const fallbackUrl = "https://api.nerofy.in/api/v1/service/aadhaar/get-data";
    const response = await axios.post(fallbackUrl, body, { headers: nerotixHeaders() });
    return response.data;
  }
};

export const verifyNerotixPan = async (panNumber: string) => {
  const url =
    process.env.NEROTIX_PAN_VERIFY_URL ||
    "https://api.nerofy.in/api/v1/service/pancard/verify";

  const response = await axios.post(
    url,
    { panNumber },
    { headers: nerotixHeaders() }
  );

  return response.data;
};

const kycaidHostedForm = async (user: any) => {
  const token = process.env.KYCAID_API_TOKEN;
  const formId = process.env.KYCAID_FORM_ID;

  if (!token || !formId) {
    throw new Error("KYCAID_API_TOKEN and KYCAID_FORM_ID are required");
  }

  const body: Record<string, string> = {
    external_applicant_id: String(user.id),
    redirect_url: process.env.KYCAID_REDIRECT_URL || "https://exgold.in/kyc-success",
  };

  const response = await axios.post(
    `${KYCAID_BASE_URL}/forms/${formId}/urls`,
    body,
    {
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return {
    provider: "kycaid",
    ...response.data,
  };
};
