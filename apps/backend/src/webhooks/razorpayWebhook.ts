import { createHmac, timingSafeEqual } from "node:crypto";

export const verifyRazorpaySignature = (rawBody: Buffer, signature: string | undefined, secret: string): boolean => {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};

export const parseRazorpayWebhook = (rawBody: Buffer): { event: string; paymentLink: import("../payments/razorpayTypes.js").RazorpayPaymentLink } => {
  const payload = JSON.parse(rawBody.toString("utf8")) as {
    event?: string;
    payload?: { payment_link?: { entity?: import("../payments/razorpayTypes.js").RazorpayPaymentLink } };
  };
  const rawPaymentLink = payload.payload?.payment_link?.entity as (import("../payments/razorpayTypes.js").RazorpayPaymentLink & {
    amount_paid?: number;
    expire_by?: number;
  }) | undefined;
  const paymentLink = rawPaymentLink && {
    ...rawPaymentLink,
    amountPaid: rawPaymentLink.amount_paid ?? rawPaymentLink.amountPaid,
    expire_by: rawPaymentLink.expire_by
  };
  if (!payload.event || !paymentLink || typeof paymentLink.id !== "string") throw new Error("Malformed Razorpay webhook payload");
  return { event: payload.event, paymentLink };
};
