import { describe, expect, it } from "vitest";

import {
  calculateExpectedRecoveryValue,
  inrRupeesToPaise,
  type RecoveryCaseInput
} from "../../recovery/domain/recoveryCase.js";
import { scoreRecoveryCase } from "../../recovery/scoring/baselineScoring.js";

const buildCase = (overrides: Partial<RecoveryCaseInput> = {}): RecoveryCaseInput => ({
  caseId: "case_test_001",
  customerId: "cust_test_001",
  amountAtRisk: inrRupeesToPaise(100_000),
  currency: "INR",
  scenarioType: "PAYMENT_FAILED",
  failureReason: "NETWORK_ERROR",
  customerHistory: {
    successfulPayments: 6,
    failedPayments: 0,
    chargebacks: 0,
    daysSinceLastSuccessfulPayment: 12,
    lifetimeValue: inrRupeesToPaise(800_000),
    isRepeatCustomer: true,
    optedOut: false
  },
  previousAttempts: 0,
  checkoutStatus: "PAYMENT_INITIATED",
  status: "AT_RISK",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

describe("baseline recovery scoring", () => {
  it("calculates expected recovery value as integer paise", () => {
    expect(calculateExpectedRecoveryValue(inrRupeesToPaise(5_000), 0.37)).toBe(185_000);
  });

  it("scores a strong technical failure opportunity higher than a repeated low-intent case", () => {
    const strongOpportunity = scoreRecoveryCase(buildCase());
    const weakOpportunity = scoreRecoveryCase(
      buildCase({
        scenarioType: "CHECKOUT_ABANDONED",
        failureReason: "PRICE_SHOCK",
        customerHistory: {
          successfulPayments: 0,
          failedPayments: 5,
          chargebacks: 1,
          lifetimeValue: 0,
          isRepeatCustomer: false,
          optedOut: false
        },
        previousAttempts: 3,
        checkoutStatus: "ABANDONED_BEFORE_PAYMENT"
      })
    );

    expect(strongOpportunity.recoveryProbability).toBeGreaterThan(weakOpportunity.recoveryProbability);
    expect(strongOpportunity.expectedRecoveryValue).toBeGreaterThan(weakOpportunity.expectedRecoveryValue);
    expect(strongOpportunity.reasons).toContain("Network errors are often recoverable with a retry or link.");
  });

  it("returns zero probability for terminal cases", () => {
    const score = scoreRecoveryCase(buildCase({ status: "STOPPED" }));

    expect(score).toEqual({
      recoveryProbability: 0,
      expectedRecoveryValue: 0,
      reasons: ["Terminal status STOPPED prevents further recovery scoring."]
    });
  });
});
