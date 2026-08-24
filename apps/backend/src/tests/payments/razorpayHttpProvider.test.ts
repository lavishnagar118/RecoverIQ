import { describe, expect, it, vi } from "vitest";
import { RazorpayHttpProvider } from "../../payments/razorpayHttpProvider.js";
import { RazorpayProviderError } from "../../payments/razorpayErrors.js";

const config = {
  mode: "test" as const,
  keyId: "rzp_test_key",
  keySecret: "test_secret",
  webhookSecret: "webhook",
  apiBaseUrl: "https://api.razorpay.com",
  requestTimeoutMs: 100
};

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
}) as Response;

describe("RazorpayHttpProvider", () => {
  it("maps successful create requests without exposing credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, {
      id: "plink_1", amount: 100, currency: "INR", reference_id: "case:1:CREATE_PAYMENT_LINK", status: "created"
    }));
    const provider = new RazorpayHttpProvider(config, fetchImpl);
    await provider.createPaymentLink({
      amountPaise: 100, currency: "INR", referenceId: "case:1:CREATE_PAYMENT_LINK",
      description: "Recovery", expireByUnixSeconds: Math.floor(Date.now() / 1000) + 3600
    });

    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(JSON.stringify(fetchImpl.mock.calls[0][1])).not.toContain("test_secret");
  });

  it("maps a realistic Razorpay list response separately", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, {
      count: 1,
      items: [{
        id: "plink_1",
        amount: 100,
        amount_paid: 0,
        currency: "INR",
        reference_id: "case:1:CREATE_PAYMENT_LINK",
        status: "created",
        short_url: "https://rzp.io/demo"
      }]
    }));
    const provider = new RazorpayHttpProvider(config, fetchImpl);
    await expect(provider.findPaymentLinksByReferenceId("case:1:CREATE_PAYMENT_LINK")).resolves.toMatchObject([
      { id: "plink_1", amount: 100, reference_id: "case:1:CREATE_PAYMENT_LINK" }
    ]);
  });

  it.each([
    [401, "AUTHENTICATION_ERROR"],
    [422, "CLIENT_ERROR"],
    [503, "SERVER_ERROR"]
  ] as const)("maps HTTP %s errors", async (status, code) => {
    const provider = new RazorpayHttpProvider(config, vi.fn().mockResolvedValue(response(status, {})));
    await expect(provider.fetchPaymentLink("plink_1")).rejects.toMatchObject({ code });
  });

  it("maps missing credentials and timeout", async () => {
    const missing = new RazorpayHttpProvider({ ...config, keyId: undefined }, vi.fn());
    await expect(missing.fetchPaymentLink("plink_1")).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    const timeout = new RazorpayHttpProvider(config, vi.fn().mockRejectedValue(Object.assign(new Error(), { name: "AbortError" })));
    await expect(timeout.fetchPaymentLink("plink_1")).rejects.toBeInstanceOf(RazorpayProviderError);
  });
});
