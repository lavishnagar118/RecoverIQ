import { describe, expect, it } from "vitest";
import { defaultRecoveryPolicy } from "../../recovery/domain/recoveryPolicy.js";
import { validatePaymentLinkExecution } from "../../recovery/execution/recoveryPolicyGate.js";

const baseCase = {
  caseId: "case", customerId: "customer", amountAtRisk: 100, currency: "INR" as const,
  scenarioType: "PAYMENT_FAILED" as const, failureReason: "BANK_DECLINED" as const,
  customerHistory: { successfulPayments: 0, failedPayments: 1, chargebacks: 0, lifetimeValue: 100, isRepeatCustomer: false, optedOut: false },
  previousAttempts: 0, checkoutStatus: "PAYMENT_FAILED" as const, status: "ACTION_SELECTED" as const,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
};

describe("Payment Link policy gate", () => {
  it("rejects terminal cases, attempt limits, and missing approval", () => {
    expect(() => validatePaymentLinkExecution({ ...baseCase, status: "RECOVERED" }, defaultRecoveryPolicy, 1, false, false)).toThrow();
    expect(() => validatePaymentLinkExecution(baseCase, defaultRecoveryPolicy, 4, false, false)).toThrow("attempt limit");
    expect(() => validatePaymentLinkExecution({ ...baseCase, amountAtRisk: 100_000_000 }, defaultRecoveryPolicy, 1, true, false)).toThrow("approval");
  });
});
