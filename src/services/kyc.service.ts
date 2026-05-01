import axios from "axios";

const PROVIDER = process.env.KYC_PROVIDER || "digio";

export const createKycRequest = async (user: any) => {
  if (PROVIDER === "digio") {
    return digioKyc(user);
  }

  throw new Error("KYC provider not configured");
};

const digioKyc = async (user: any) => {
  const response = await axios.post(
    "https://api.digio.in/client/kyc/v2/request",
    {
      customer_identifier: user.id,
      customer_name: user.name,
      template_name: "KYC_TEMPLATE",
    },
    {
      auth: {
        username: process.env.DIGIO_CLIENT_ID!,
        password: process.env.DIGIO_CLIENT_SECRET!,
      },
    }
  );

  return response.data;
};