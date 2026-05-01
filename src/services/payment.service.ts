// ===============================
// services/payment.service.ts
// ===============================
import crypto from "crypto";

export const verifyRazorpaySignature = (
  orderId: string,
  paymentId: string,
  signature: string
) => {
  const secret = process.env.RAZORPAY_KEY_SECRET!;

  const generated = crypto
    .createHmac("sha256", secret)
    .update(orderId + "|" + paymentId)
    .digest("hex");

  return generated === signature;
};

export const verifySubscriptionSignature = (
  paymentId: string,
  subscriptionId: string,
  signature: string
) => {
  const secret = process.env.RAZORPAY_KEY_SECRET!;

  const generated = crypto
    .createHmac("sha256", secret)
    .update(paymentId + "|" + subscriptionId)
    .digest("hex");

  return generated === signature;
};