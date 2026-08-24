import { describe, expect, it } from "vitest";

import {
  inrRupeesToPaise,
  assertIntegerPaise,
  type RecoveryCaseInput
} from "../../recovery/domain/recoveryCase.js";
import {
  defaultRecoveryPolicy,
  type RecoveryPolicy
} from "../../recovery/domain/recoveryPolicy.js";
import {
  clampActionProbability,
  roundActionProbability,
  scoreRecoveryAction
} from "../../recovery/decision/actionScoring.js";
import { scoreRecoveryCase } from "../../recovery/scoring/baselineScoring.js";

const buildCase = (overrides: Partial<RecoveryCaseInput> = {}): RecoveryCaseInput => ({
  caseId: "case_action_test",
  customerId: "cust_action_test",
  amountAtRisk: inrRupeesToPaise(10_000),
  currency: "INR",
  scenarioType: "PAYMENT_FAILED",
  failureReason: "NETWORK_ERROR",
  customerHistory: {
    successfulPayments: 6,
    failedPayments: 0,
    chargebacks: 0,
    daysSinceLastSuccessfulPayment: 12,
    lifetimeValue: inrRupeesToPaise(80_000),
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

const buildPolicy = (overrides: Partial<RecoveryPolicy> = {}): RecoveryPolicy => ({
  ...defaultRecoveryPolicy,
  fixedActionCostsPaise: {
    ...defaultRecoveryPolicy.fixedActionCostsPaise
  },
  ...overrides
});

const score = (
  action: Parameters<typeof scoreRecoveryAction>[0],
  recoveryCase: RecoveryCaseInput = buildCase(),
  policy = buildPolicy()
) =>
  scoreRecoveryAction(action, {
    recoveryCase,
    baselineScore: scoreRecoveryCase(recoveryCase),
    policy
  });

describe("recovery action scoring", () => {
  it("applies suitability rules for all candidate actions", () => {
    expect(score("RETRY_PAYMENT").appropriate).toBe(true);
    expect(score("SEND_REMINDER").appropriate).toBe(true);
    expect(score("CREATE_PAYMENT_LINK").appropriate).toBe(true);
    expect(score("OFFER_DISCOUNT").appropriate).toBe(false);
    expect(score("STOP").appropriate).toBe(true);
    expect(score("OFFER_DISCOUNT").reasons).toContain(
      "Discounts are only appropriate for checkout abandonment."
    );
  });

  it("covers every retry failure-reason branch", () => {
    const cases: Array<[RecoveryCaseInput["failureReason"], number]> = [
      ["NETWORK_ERROR", 0.12],
      ["AUTHENTICATION_FAILED", 0.08],
      ["CHECKOUT_TIMEOUT", 0.08],
      ["INSUFFICIENT_FUNDS", -0.1],
      ["BANK_DECLINED", -0.1],
      ["LIMIT_EXCEEDED", -0.1],
      ["UNKNOWN", 0.04]
    ];

    for (const [failureReason, adjustment] of cases) {
      const recoveryCase = buildCase({ failureReason });
      const baseline = scoreRecoveryCase(recoveryCase);
      expect(score("RETRY_PAYMENT", recoveryCase).recoveryProbability).toBe(
        roundActionProbability(baseline.recoveryProbability + adjustment)
      );
    }
  });

  it("reduces retry probability and value for previous attempts", () => {
    const first = score("RETRY_PAYMENT", buildCase({ previousAttempts: 0 }));
    const second = score("RETRY_PAYMENT", buildCase({ previousAttempts: 1 }));

    expect(second.recoveryProbability).toBeLessThan(first.recoveryProbability);
    expect(second.expectedNetRecovery).toBeLessThan(first.expectedNetRecovery);
    expect(second.reasons.join(" ")).toContain("previous attempt");
  });

  it("invalidates retry at the maximum attempt limit", () => {
    const candidate = score(
      "RETRY_PAYMENT",
      buildCase({ previousAttempts: defaultRecoveryPolicy.maximumAutomaticAttempts })
    );

    expect(candidate.appropriate).toBe(false);
    expect(candidate.reasons).toContain("Maximum automatic attempts have been reached.");
  });

  it("invalidates communication actions for opted-out customers", () => {
    const optedOutCase = buildCase({
      customerHistory: {
        ...buildCase().customerHistory,
        optedOut: true
      }
    });

    for (const action of ["SEND_REMINDER", "CREATE_PAYMENT_LINK", "OFFER_DISCOUNT"] as const) {
      expect(score(action, optedOutCase).appropriate).toBe(false);
    }
  });

  it("supports discount configuration and includes discount cost in net recovery", () => {
    const abandonedCase = buildCase({
      scenarioType: "CHECKOUT_ABANDONED",
      failureReason: "PRICE_SHOCK",
      checkoutStatus: "ABANDONED_BEFORE_PAYMENT"
    });
    const candidate = score("OFFER_DISCOUNT", abandonedCase);

    expect(candidate.appropriate).toBe(true);
    expect(candidate.discountCost).toBe(
      Math.round(candidate.expectedRecoveredAmount * defaultRecoveryPolicy.discountRate)
    );
    expect(candidate.expectedNetRecovery).toBe(
      candidate.expectedRecoveredAmount - candidate.estimatedActionCost
    );
  });

  it("invalidates disabled discounts", () => {
    const candidate = score(
      "OFFER_DISCOUNT",
      buildCase({
        scenarioType: "CHECKOUT_ABANDONED",
        checkoutStatus: "ABANDONED_BEFORE_PAYMENT"
      }),
      buildPolicy({ allowDiscounts: false })
    );

    expect(candidate.appropriate).toBe(false);
    expect(candidate.reasons).toContain("Discounts are disabled by policy.");
  });

  it("gives payment links their payment-method-specific adjustment", () => {
    const paymentMethodCase = buildCase({
      failureReason: "PAYMENT_METHOD_UNAVAILABLE"
    });
    const genericCase = buildCase({ failureReason: "UNKNOWN" });
    const paymentMethodCandidate = score("CREATE_PAYMENT_LINK", paymentMethodCase);
    const genericCandidate = score("CREATE_PAYMENT_LINK", genericCase);

    expect(
      paymentMethodCandidate.recoveryProbability -
        scoreRecoveryCase(paymentMethodCase).recoveryProbability
    ).toBeCloseTo(0.06, 10);
    expect(
      genericCandidate.recoveryProbability - scoreRecoveryCase(genericCase).recoveryProbability
    ).toBeCloseTo(0.05, 10);
  });

  it("marks valid high-value candidates for approval", () => {
    const candidate = score(
      "RETRY_PAYMENT",
      buildCase({ amountAtRisk: inrRupeesToPaise(1_000_000) })
    );

    expect(candidate.requiresApproval).toBe(true);
  });

  it("returns integer paise values and bounded rounded probabilities", () => {
    const candidate = score("RETRY_PAYMENT");

    expect(Number.isSafeInteger(candidate.expectedRecoveredAmount)).toBe(true);
    expect(Number.isSafeInteger(candidate.estimatedActionCost)).toBe(true);
    expect(Number.isSafeInteger(candidate.discountCost)).toBe(true);
    expect(Number.isSafeInteger(candidate.expectedNetRecovery)).toBe(true);
    expect(candidate.recoveryProbability).toBe(roundActionProbability(candidate.recoveryProbability));
    expect(candidate.recoveryProbability).toBeGreaterThanOrEqual(0);
    expect(candidate.recoveryProbability).toBeLessThanOrEqual(0.95);
  });

  it("handles zero-value money cases safely", () => {
    const candidate = score("RETRY_PAYMENT", buildCase({ amountAtRisk: 0 }));

    expect(candidate.expectedRecoveredAmount).toBe(0);
    expect(candidate.expectedNetRecovery).toBe(-defaultRecoveryPolicy.fixedActionCostsPaise.RETRY_PAYMENT);
    expect(candidate.score).toBe(0);
  });

  it("validates safe integer paise values", () => {
    expect(() => assertIntegerPaise(-1, "amountAtRisk")).toThrow();
    expect(() => assertIntegerPaise(Number.MAX_SAFE_INTEGER + 1, "amountAtRisk")).toThrow();
    expect(() => inrRupeesToPaise(Number.MAX_SAFE_INTEGER)).toThrow();
  });

  it("clamps probabilities to the approved range", () => {
    expect(clampActionProbability(-1)).toBe(0);
    expect(clampActionProbability(2)).toBe(0.95);
    expect(roundActionProbability(0.956)).toBe(0.95);
  });

  it("does not claim real-world costs", () => {
    expect(score("RETRY_PAYMENT").estimatedActionCost).toBe(
      defaultRecoveryPolicy.fixedActionCostsPaise.RETRY_PAYMENT
    );
  });
});
