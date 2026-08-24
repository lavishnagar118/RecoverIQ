import { describe, expect, it } from "vitest";

import {
  inrRupeesToPaise,
  type RecoveryCaseInput
} from "../../recovery/domain/recoveryCase.js";
import {
  defaultRecoveryPolicy,
  type RecoveryPolicy
} from "../../recovery/domain/recoveryPolicy.js";
import {
  compareRecoveryActionCandidates,
  selectRecoveryAction
} from "../../recovery/decision/recoveryActionEngine.js";
import type { RecoveryActionCandidate } from "../../recovery/decision/actionScoring.js";

const buildCase = (overrides: Partial<RecoveryCaseInput> = {}): RecoveryCaseInput => ({
  caseId: "case_engine_test",
  customerId: "cust_engine_test",
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

describe("recovery action engine", () => {
  it("selects retry for a recoverable network-error payment failure", () => {
    const decision = selectRecoveryAction(buildCase());

    expect(decision.selectedAction).toBe("RETRY_PAYMENT");
    expect(decision.decisionStrength).toBe("STRONG");
  });

  it("selects deterministically among reminder, link, and discount for abandonment", () => {
    const abandonedCase = buildCase({
      scenarioType: "CHECKOUT_ABANDONED",
      failureReason: "PRICE_SHOCK",
      checkoutStatus: "ABANDONED_BEFORE_PAYMENT",
      customerHistory: {
        ...buildCase().customerHistory,
        isRepeatCustomer: false
      }
    });
    const first = selectRecoveryAction(abandonedCase);
    const second = selectRecoveryAction(abandonedCase);

    expect(["SEND_REMINDER", "CREATE_PAYMENT_LINK", "OFFER_DISCOUNT"]).toContain(
      first.selectedAction
    );
    expect(second).toEqual(first);
  });

  it("forces STOP for terminal cases", () => {
    const decision = selectRecoveryAction(buildCase({ status: "EXPIRED" }));

    expect(decision.selectedAction).toBe("STOP");
    expect(decision.decisionStrength).toBe("STOP");
  });

  it("forces every terminal status to a valid STOP candidate", () => {
    for (const status of [
      "RECOVERED",
      "STOPPED",
      "EXPIRED",
      "CANCELLED",
      "CUSTOMER_OPTED_OUT"
    ] as const) {
      const decision = selectRecoveryAction(
        buildCase({
          status,
          customerHistory: {
            ...buildCase().customerHistory,
            optedOut: status === "CUSTOMER_OPTED_OUT"
          }
        })
      );
      const stopCandidate = decision.candidates.find(
        (candidate) => candidate.action === "STOP"
      );

      expect(decision.selectedAction).toBe("STOP");
      expect(decision.selectedCandidate.appropriate).toBe(true);
      expect(stopCandidate?.appropriate).toBe(true);
    }
  });

  it("returns all candidates with explicit reasons", () => {
    const decision = selectRecoveryAction(buildCase());

    expect(decision.candidates).toHaveLength(5);
    for (const candidate of decision.candidates) {
      expect(candidate.action).toBeTruthy();
      expect(candidate.reasons.length).toBeGreaterThan(0);
      expect(candidate).toHaveProperty("appropriate");
      expect(candidate).toHaveProperty("recoveryProbability");
      expect(candidate).toHaveProperty("expectedRecoveredAmount");
      expect(candidate).toHaveProperty("estimatedActionCost");
      expect(candidate).toHaveProperty("discountCost");
      expect(candidate).toHaveProperty("expectedNetRecovery");
      expect(candidate).toHaveProperty("requiresApproval");
    }
  });

  it("never selects an invalid non-STOP candidate", () => {
    const decision = selectRecoveryAction(
      buildCase({ previousAttempts: defaultRecoveryPolicy.maximumAutomaticAttempts })
    );

    expect(decision.selectedCandidate.appropriate).toBe(true);
    expect(decision.selectedAction).not.toBe("RETRY_PAYMENT");
    expect(
      decision.candidates
        .filter((candidate) => !candidate.appropriate)
        .some((candidate) => candidate.action === decision.selectedAction)
    ).toBe(false);
  });

  it("selects STOP when all non-STOP candidates are below the minimum", () => {
    const decision = selectRecoveryAction(
      buildCase({
        customerHistory: {
          successfulPayments: 0,
          failedPayments: 5,
          chargebacks: 1,
          lifetimeValue: 0,
          isRepeatCustomer: false,
          optedOut: false
        },
        failureReason: "INSUFFICIENT_FUNDS",
        previousAttempts: 2
      }),
      buildPolicy({ minimumExpectedNetRecoveryPaise: inrRupeesToPaise(1_000_000) })
    );

    expect(decision.selectedAction).toBe("STOP");
  });

  it("uses stable tie-breaking after net recovery, probability, and cost", () => {
    const equalCostPolicy = buildPolicy({
      fixedActionCostsPaise: {
        RETRY_PAYMENT: 0,
        SEND_REMINDER: 0,
        CREATE_PAYMENT_LINK: 0,
        OFFER_DISCOUNT: 0,
        STOP: 0
      }
    });

    const decision = selectRecoveryAction(
      buildCase({
        scenarioType: "CHECKOUT_ABANDONED",
        failureReason: "UNKNOWN",
        checkoutStatus: "ABANDONED_BEFORE_PAYMENT"
      }),
      equalCostPolicy
    );

    expect(decision.candidates.map((candidate) => candidate.action)).toEqual([
      "RETRY_PAYMENT",
      "SEND_REMINDER",
      "CREATE_PAYMENT_LINK",
      "OFFER_DISCOUNT",
      "STOP"
    ]);
    expect(decision.selectedAction).toBe("CREATE_PAYMENT_LINK");
  });

  it("uses the final action order when all ranked values are identical", () => {
    const candidate = (action: RecoveryActionCandidate["action"]): RecoveryActionCandidate => ({
      action,
      appropriate: true,
      recoveryProbability: 0.5,
      expectedRecoveredAmount: 500,
      estimatedActionCost: 10,
      discountCost: 0,
      expectedNetRecovery: 490,
      score: 0.5,
      requiresApproval: false,
      reasons: ["test candidate"]
    });
    const sorted = [
      candidate("OFFER_DISCOUNT"),
      candidate("SEND_REMINDER"),
      candidate("CREATE_PAYMENT_LINK")
    ].sort(compareRecoveryActionCandidates);

    expect(sorted.map((entry) => entry.action)).toEqual([
      "SEND_REMINDER",
      "CREATE_PAYMENT_LINK",
      "OFFER_DISCOUNT"
    ]);
  });

  it("marks high-value selected candidates as requiring approval", () => {
    const decision = selectRecoveryAction(
      buildCase({ amountAtRisk: inrRupeesToPaise(1_000_000) })
    );

    expect(decision.selectedCandidate.requiresApproval).toBe(true);
  });

  it("does not mark invalid high-value candidates as requiring approval", () => {
    const decision = selectRecoveryAction(
      buildCase({
        amountAtRisk: inrRupeesToPaise(1_000_000),
        previousAttempts: defaultRecoveryPolicy.maximumAutomaticAttempts
      })
    );
    const retryCandidate = decision.candidates.find(
      (candidate) => candidate.action === "RETRY_PAYMENT"
    );

    expect(retryCandidate?.appropriate).toBe(false);
    expect(retryCandidate?.requiresApproval).toBe(false);
  });

  it("covers the repeatedly failed high-value scenario with a bounded decision", () => {
    const decision = selectRecoveryAction(
      buildCase({
        amountAtRisk: inrRupeesToPaise(1_000_000),
        failureReason: "BANK_DECLINED",
        previousAttempts: 3,
        customerHistory: {
          successfulPayments: 0,
          failedPayments: 5,
          chargebacks: 0,
          lifetimeValue: 0,
          isRepeatCustomer: false,
          optedOut: false
        }
      })
    );

    expect(decision.selectedAction).not.toBe("RETRY_PAYMENT");
    expect(decision.candidates.find((candidate) => candidate.action === "RETRY_PAYMENT")?.appropriate).toBe(
      false
    );
  });

  it("covers the opted-out terminal scenario", () => {
    const decision = selectRecoveryAction(
      buildCase({
        status: "CUSTOMER_OPTED_OUT",
        customerHistory: {
          ...buildCase().customerHistory,
          optedOut: true
        }
      })
    );

    expect(decision.selectedAction).toBe("STOP");
    expect(
      decision.candidates
        .filter((candidate) =>
          ["SEND_REMINDER", "CREATE_PAYMENT_LINK", "OFFER_DISCOUNT"].includes(candidate.action)
        )
        .every((candidate) => !candidate.appropriate)
    ).toBe(true);
  });

  it("rejects selection for non-decision lifecycle statuses", () => {
    for (const status of ["ACTION_EXECUTED", "WAITING_RESULT", "AWAITING_APPROVAL"] as const) {
      expect(() => selectRecoveryAction(buildCase({ status }))).toThrow(
        `Recovery action selection is not eligible while case is in status ${status}.`
      );
    }
  });

  it("handles a zero-value case by selecting STOP when actions are uneconomic", () => {
    const decision = selectRecoveryAction(buildCase({ amountAtRisk: 0 }));

    expect(decision.selectedAction).toBe("STOP");
    expect(decision.selectedCandidate.appropriate).toBe(true);
  });

  it("rejects a discount rate above the policy maximum", () => {
    expect(() =>
      selectRecoveryAction(
        buildCase(),
        buildPolicy({ discountRate: 0.2, maximumDiscountRate: 0.1 })
      )
    ).toThrow("discountRate cannot exceed maximumDiscountRate");
  });

  it("rejects invalid policy costs and thresholds", () => {
    expect(() =>
      selectRecoveryAction(
        buildCase(),
        buildPolicy({
          fixedActionCostsPaise: {
            ...defaultRecoveryPolicy.fixedActionCostsPaise,
            RETRY_PAYMENT: -1
          }
        })
      )
    ).toThrow();

    expect(() =>
      selectRecoveryAction(
        buildCase(),
        buildPolicy({ highValueApprovalThresholdPaise: -1 })
      )
    ).toThrow();

    expect(() =>
      selectRecoveryAction(
        buildCase(),
        buildPolicy({ minimumExpectedNetRecoveryPaise: -1 })
      )
    ).toThrow();
  });

  it("selects STOP when net recovery exactly equals the minimum", () => {
    const firstDecision = selectRecoveryAction(buildCase());
    const retryCandidate = firstDecision.candidates.find(
      (candidate) => candidate.action === "RETRY_PAYMENT"
    );

    expect(retryCandidate).toBeDefined();
    const decision = selectRecoveryAction(
      buildCase(),
      buildPolicy({
        minimumExpectedNetRecoveryPaise: retryCandidate?.expectedNetRecovery ?? 0
      })
    );

    expect(decision.selectedAction).toBe("STOP");
  });
});
