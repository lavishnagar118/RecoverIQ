import { describe, expect, it } from "vitest";
import { validateRazorpayTestModeConfig } from "../../payments/razorpayHttpProvider.js";

const base = {
  mode: "test" as const,
  keyId: "rzp_test_key",
  keySecret: "test_secret",
  webhookSecret: "webhook",
  apiBaseUrl: "https://api.razorpay.com",
  requestTimeoutMs: 100
};

describe("Razorpay Test Mode enforcement", () => {
  it("accepts valid Test Mode configuration", () => {
    expect(() => validateRazorpayTestModeConfig(base)).not.toThrow();
  });

  it.each([
    [{ ...base, mode: undefined }, "RAZORPAY_MODE=test"],
    [{ ...base, mode: "live" }, "RAZORPAY_MODE=test"],
    [{ ...base, apiBaseUrl: "https://live.example.com" }, "official Test Mode"],
    [{ ...base, keyId: "rzp_live_key" }, "Test Mode credentials"],
    [{ ...base, keySecret: "rzp_live_secret" }, "Test Mode credentials"]
  ] as const)("rejects unsafe configuration", (config, message) => {
    expect(() => validateRazorpayTestModeConfig(config)).toThrow(message);
  });
});
