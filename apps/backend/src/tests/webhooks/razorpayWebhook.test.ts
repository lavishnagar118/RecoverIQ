import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyRazorpaySignature } from "../../webhooks/razorpayWebhook.js";

describe("Razorpay webhook signature verification", () => {
  it("verifies the exact raw body and rejects missing signatures", () => {
    const body = Buffer.from('{"event":"payment_link.paid"}');
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyRazorpaySignature(body, signature, "secret")).toBe(true);
    expect(verifyRazorpaySignature(Buffer.from('{"event":"payment_link.paid"} '), signature, "secret")).toBe(false);
    expect(verifyRazorpaySignature(body, undefined, "secret")).toBe(false);
  });
});
