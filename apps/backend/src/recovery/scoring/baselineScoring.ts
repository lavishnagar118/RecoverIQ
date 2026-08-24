import {
  calculateExpectedRecoveryValue,
  inrRupeesToPaise,
  type RecoveryCase,
  type RecoveryCaseInput
} from "../domain/recoveryCase.js";
import { isTerminalRecoveryStatus } from "../domain/recoveryState.js";

export interface RecoveryScoringResult {
  recoveryProbability: number;
  expectedRecoveryValue: number;
  reasons: string[];
}

interface ScoringRule {
  applies: (recoveryCase: RecoveryCaseInput) => boolean;
  adjustment: number;
  reason: string;
}

const clampProbability = (value: number) => Math.min(0.9, Math.max(0.01, value));

const roundProbability = (value: number) => Math.round(value * 100) / 100;

const highValueCaseThresholdPaise = inrRupeesToPaise(1_000_000);
const lowValueCaseThresholdPaise = inrRupeesToPaise(100_000);

const baselineProbability = (recoveryCase: RecoveryCaseInput): RecoveryScoringResult => {
  if (isTerminalRecoveryStatus(recoveryCase.status)) {
    return {
      recoveryProbability: 0,
      expectedRecoveryValue: 0,
      reasons: [`Terminal status ${recoveryCase.status} prevents further recovery scoring.`]
    };
  }

  if (recoveryCase.customerHistory.optedOut) {
    return {
      recoveryProbability: 0,
      expectedRecoveryValue: 0,
      reasons: ["Customer has opted out of recovery communication."]
    };
  }

  const base =
    recoveryCase.scenarioType === "PAYMENT_FAILED"
      ? {
          probability: 0.45,
          reason: "Payment failure cases start from a moderate baseline recoverability."
        }
      : {
          probability: 0.32,
          reason: "Checkout abandonment cases start from a lower baseline recoverability."
        };

  const rules: ScoringRule[] = [
    {
      applies: (caseInput) => caseInput.failureReason === "NETWORK_ERROR",
      adjustment: 0.16,
      reason: "Network errors are often recoverable with a retry or link."
    },
    {
      applies: (caseInput) => caseInput.failureReason === "AUTHENTICATION_FAILED",
      adjustment: 0.06,
      reason: "Authentication failures can recover when the customer retries deliberately."
    },
    {
      applies: (caseInput) => caseInput.failureReason === "PAYMENT_METHOD_UNAVAILABLE",
      adjustment: 0.04,
      reason: "Unavailable payment method can recover if alternatives are offered."
    },
    {
      applies: (caseInput) => caseInput.failureReason === "CHECKOUT_TIMEOUT",
      adjustment: 0.12,
      reason: "Checkout timeouts are usually technical interruptions."
    },
    {
      applies: (caseInput) => caseInput.failureReason === "INSUFFICIENT_FUNDS",
      adjustment: -0.12,
      reason: "Insufficient funds lowers short-term recoverability."
    },
    {
      applies: (caseInput) => caseInput.failureReason === "BANK_DECLINED",
      adjustment: -0.07,
      reason: "Bank declines are less directly recoverable by merchant action."
    },
    {
      applies: (caseInput) => caseInput.failureReason === "LIMIT_EXCEEDED",
      adjustment: -0.1,
      reason: "Limit exceeded failures usually need customer-side action."
    },
    {
      applies: (caseInput) => caseInput.failureReason === "USER_ABANDONED",
      adjustment: -0.08,
      reason: "Voluntary abandonment lowers recovery likelihood."
    },
    {
      applies: (caseInput) => caseInput.failureReason === "PRICE_SHOCK",
      adjustment: -0.12,
      reason: "Price shock indicates purchase intent weakened before payment."
    },
    {
      applies: (caseInput) => caseInput.customerHistory.isRepeatCustomer,
      adjustment: 0.1,
      reason: "Repeat customers are more likely to complete recovery."
    },
    {
      applies: (caseInput) => caseInput.customerHistory.successfulPayments >= 5,
      adjustment: 0.08,
      reason: "Strong successful payment history improves recoverability."
    },
    {
      applies: (caseInput) => caseInput.customerHistory.successfulPayments === 0,
      adjustment: -0.08,
      reason: "No successful payment history lowers confidence."
    },
    {
      applies: (caseInput) => caseInput.customerHistory.failedPayments >= 3,
      adjustment: -0.12,
      reason: "Repeated payment failures reduce near-term recoverability."
    },
    {
      applies: (caseInput) => caseInput.customerHistory.chargebacks > 0,
      adjustment: -0.15,
      reason: "Prior chargeback history lowers recovery confidence."
    },
    {
      applies: (caseInput) => caseInput.previousAttempts === 0,
      adjustment: 0.04,
      reason: "No prior recovery attempts remain available."
    },
    {
      applies: (caseInput) => caseInput.previousAttempts === 2,
      adjustment: -0.1,
      reason: "Two prior attempts indicate weaker remaining recovery opportunity."
    },
    {
      applies: (caseInput) => caseInput.previousAttempts >= 3,
      adjustment: -0.22,
      reason: "Three or more attempts indicate the case should be close to stopping."
    },
    {
      applies: (caseInput) => caseInput.checkoutStatus === "PAYMENT_INITIATED",
      adjustment: 0.08,
      reason: "Payment initiation indicates clear purchase intent."
    },
    {
      applies: (caseInput) => caseInput.checkoutStatus === "PAYMENT_FAILED",
      adjustment: 0.04,
      reason: "Reached-payment failures retain stronger purchase intent."
    },
    {
      applies: (caseInput) => caseInput.checkoutStatus === "ABANDONED_BEFORE_PAYMENT",
      adjustment: -0.1,
      reason: "Abandonment before payment indicates weaker intent."
    },
    {
      applies: (caseInput) => caseInput.amountAtRisk >= highValueCaseThresholdPaise,
      adjustment: -0.04,
      reason: "High-value cases may need more consideration before recovery."
    },
    {
      applies: (caseInput) => caseInput.amountAtRisk <= lowValueCaseThresholdPaise,
      adjustment: 0.04,
      reason: "Lower-value checkouts usually face less purchase friction."
    }
  ];

  const appliedRules = rules.filter((rule) => rule.applies(recoveryCase));
  const rawProbability = appliedRules.reduce(
    (probability, rule) => probability + rule.adjustment,
    base.probability
  );
  const recoveryProbability = roundProbability(clampProbability(rawProbability));

  return {
    recoveryProbability,
    expectedRecoveryValue: calculateExpectedRecoveryValue(
      recoveryCase.amountAtRisk,
      recoveryProbability
    ),
    reasons: [base.reason, ...appliedRules.map((rule) => rule.reason)]
  };
};

export const scoreRecoveryCase = (recoveryCase: RecoveryCaseInput): RecoveryScoringResult =>
  baselineProbability(recoveryCase);

export const applyRecoveryScore = (recoveryCase: RecoveryCaseInput): RecoveryCase => {
  const score = scoreRecoveryCase(recoveryCase);

  return {
    ...recoveryCase,
    recoveryProbability: score.recoveryProbability,
    expectedRecoveryValue: score.expectedRecoveryValue,
    scoringReasons: score.reasons
  };
};
