import Razorpay from "razorpay";

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

if (!keyId || !keySecret) {
  throw new Error("Razorpay live credentials are not configured");
}

export const razorpay = new Razorpay({
  key_id: keyId,
  key_secret: keySecret
});
