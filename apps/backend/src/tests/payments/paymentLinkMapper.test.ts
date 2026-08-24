import { describe, expect, it } from "vitest";
import { buildPaymentLinkReferenceId, mapPaymentLinkRequest } from "../../payments/paymentLinkMapper.js";

describe("Payment Link mapping", () => {
  it("maps integer paise and deterministic reference data", () => {
    expect(buildPaymentLinkReferenceId("case-1", 2, "CREATE_PAYMENT_LINK")).toBe("case-1:2:CREATE_PAYMENT_LINK");
    expect(mapPaymentLinkRequest({
      amountPaise: 12_500,
      currency: "INR",
      referenceId: "case-1:2:CREATE_PAYMENT_LINK",
      description: "Recovery",
      expireByUnixSeconds: Math.floor(Date.now() / 1000) + 3600
    })).toMatchObject({ amount: 12_500, currency: "INR", accept_partial: false });
  });

  it("rejects non-positive or unsafe amounts", () => {
    expect(() => mapPaymentLinkRequest({
      amountPaise: 0,
      currency: "INR",
      referenceId: "x",
      description: "x",
      expireByUnixSeconds: Math.floor(Date.now() / 1000) + 3600
    })).toThrow("amountPaise must be positive");
  });
});
