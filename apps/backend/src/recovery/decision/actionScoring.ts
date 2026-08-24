import {
  calculateExpectedRecoveryValue,
  type RecoveryCaseInput
} from "../domain/recoveryCase.js";
import { isTerminalRecoveryStatus } from "../domain/recoveryState.js";
import type { RecoveryAction } from "../actions/recoveryActions.js";
import {
  type RecoveryPolicy,
  validateRecoveryPolicy
} from "../domain/recoveryPolicy.js";
import type { RecoveryScoringResult } from "../scoring/baselineScoring.js";

export interface RecoveryActionCandidate {
  action: RecoveryAction;
  appropriate: boolean;
  recoveryProbability: number;
  expectedRecoveredAmount: number;
  estimatedActionCost: number;
  discountCost: number;
  expectedNetRecovery: number;
  score: number | null;
  requiresApproval: boolean;
  reasons: string[];
}

export interface RecoveryActionScoringContext {
  recoveryCase: RecoveryCaseInput;
  baselineScore: RecoveryScoringResult;
  policy: RecoveryPolicy;
}

const maximumProbability = 0.95;

export const clampActionProbability = (value: number): number =>
  Math.min(maximumProbability, Math.max(0, value));

export const roundActionProbability = (value: number): number =>
  Math.round(clampActionProbability(value) * 100) / 100;

const roundScore = (value: number): number => Math.round(value * 10_000) / 10_000;

const isCommunicationAction = (action: RecoveryAction): boolean =>
  action === "SEND_REMINDER" ||
  action === "CREATE_PAYMENT_LINK" ||
  action === "OFFER_DISCOUNT";

const invalidCandidate = (
  action: RecoveryAction,
  reason: string
): RecoveryActionCandidate => ({
  action,
  appropriate: false,
  recoveryProbability: 0,
  expectedRecoveredAmount: 0,
  estimatedActionCost: 0,
  discountCost: 0,
  expectedNetRecovery: 0,
  score: null,
  requiresApproval: false,
  reasons: [reason]
});

const getActionAdjustment = (
  action: RecoveryAction,
  recoveryCase: RecoveryCaseInput
): { adjustment: number; reason: string } => {
  switch (action) {
    case "RETRY_PAYMENT":
      if (recoveryCase.failureReason === "NETWORK_ERROR") {
        return {
          adjustment: 0.12,
          reason: "Retry is well suited to a network interruption."
        };
      }

      if (
        recoveryCase.failureReason === "AUTHENTICATION_FAILED" ||
        recoveryCase.failureReason === "CHECKOUT_TIMEOUT"
      ) {
        return {
          adjustment: 0.08,
          reason: "Retry can address this recoverable payment interruption."
        };
      }

      if (
        recoveryCase.failureReason === "INSUFFICIENT_FUNDS" ||
        recoveryCase.failureReason === "BANK_DECLINED" ||
        recoveryCase.failureReason === "LIMIT_EXCEEDED"
      ) {
        return {
          adjustment: -0.1,
          reason: "Retry is less suitable when customer or bank action is required."
        };
      }

      return {
        adjustment: 0.04,
        reason: "Retry remains a possible payment recovery path."
      };

    case "SEND_REMINDER":
      return {
        adjustment: recoveryCase.scenarioType === "CHECKOUT_ABANDONED" ? 0.08 : 0.02,
        reason:
          recoveryCase.scenarioType === "CHECKOUT_ABANDONED"
            ? "A reminder is suitable for a customer who left checkout."
            : "A reminder can prompt a customer to complete payment."
      };

    case "CREATE_PAYMENT_LINK":
      if (recoveryCase.failureReason === "PAYMENT_METHOD_UNAVAILABLE") {
        return {
          adjustment: 0.06,
          reason: "A payment link can provide an alternative payment path."
        };
      }

      return {
        adjustment: recoveryCase.scenarioType === "CHECKOUT_ABANDONED" ? 0.1 : 0.05,
        reason:
          recoveryCase.scenarioType === "CHECKOUT_ABANDONED"
            ? "A payment link gives an abandoned checkout a direct return path."
            : "A payment link offers an alternative route after payment failure."
      };

    case "OFFER_DISCOUNT":
      return {
        adjustment: recoveryCase.failureReason === "PRICE_SHOCK" ? 0.18 : 0.08,
        reason:
          recoveryCase.failureReason === "PRICE_SHOCK"
            ? "A discount directly addresses the price objection."
            : "A discount may restore intent for an abandoned checkout."
      };

    case "STOP":
      return {
        adjustment: 0,
        reason: "Stop is always available as the bounded fallback."
      };
  }
};

const checkSuitability = (
  action: RecoveryAction,
  context: RecoveryActionScoringContext
): string | undefined => {
  const { recoveryCase, policy } = context;

  if (action === "STOP") {
    return undefined;
  }

  if (isTerminalRecoveryStatus(recoveryCase.status)) {
    return `Terminal status ${recoveryCase.status} forces STOP.`;
  }

  if (isCommunicationAction(action) && recoveryCase.customerHistory.optedOut) {
    return "Customer has opted out, so communication actions are invalid.";
  }

  if (action === "RETRY_PAYMENT") {
    if (recoveryCase.scenarioType !== "PAYMENT_FAILED") {
      return "Retry is only appropriate for payment failure cases.";
    }

    if (recoveryCase.previousAttempts >= policy.maximumAutomaticAttempts) {
      return "Maximum automatic attempts have been reached.";
    }
  }

  if (action === "OFFER_DISCOUNT") {
    if (!policy.allowDiscounts) {
      return "Discounts are disabled by policy.";
    }

    if (recoveryCase.scenarioType !== "CHECKOUT_ABANDONED") {
      return "Discounts are only appropriate for checkout abandonment.";
    }
  }
};

export const scoreRecoveryAction = (
  action: RecoveryAction,
  context: RecoveryActionScoringContext
): RecoveryActionCandidate => {
  validateRecoveryPolicy(context.policy);

  const suitabilityReason = checkSuitability(action, context);
  if (suitabilityReason) {
    return invalidCandidate(action, suitabilityReason);
  }

  if (action === "STOP") {
    return {
      action,
      appropriate: true,
      recoveryProbability: 0,
      expectedRecoveredAmount: 0,
      estimatedActionCost: context.policy.fixedActionCostsPaise.STOP,
      discountCost: 0,
      expectedNetRecovery: 0,
      score: 0,
      requiresApproval: false,
      reasons: [
        isTerminalRecoveryStatus(context.recoveryCase.status)
          ? `Terminal status ${context.recoveryCase.status} requires STOP.`
          : getActionAdjustment(action, context.recoveryCase).reason
      ]
    };
  }

  // These action adjustments are deterministic simulation assumptions, not learned probabilities.
  const actionAdjustment = getActionAdjustment(action, context.recoveryCase);
  const retryAttemptAdjustment =
    action === "RETRY_PAYMENT" ? -0.12 * context.recoveryCase.previousAttempts : 0;
  const recoveryProbability = roundActionProbability(
    context.baselineScore.recoveryProbability +
      actionAdjustment.adjustment +
      retryAttemptAdjustment
  );
  const expectedRecoveredAmount = calculateExpectedRecoveryValue(
    context.recoveryCase.amountAtRisk,
    recoveryProbability
  );
  const discountCost =
    action === "OFFER_DISCOUNT"
      ? Math.round(expectedRecoveredAmount * context.policy.discountRate)
      : 0;
  const estimatedActionCost =
    context.policy.fixedActionCostsPaise[action] + discountCost;
  const expectedNetRecovery = expectedRecoveredAmount - estimatedActionCost;
  const score =
    context.recoveryCase.amountAtRisk === 0
      ? 0
      : roundScore(Math.max(expectedNetRecovery, 0) / context.recoveryCase.amountAtRisk);

  const reasons = [actionAdjustment.reason];
  if (action === "RETRY_PAYMENT" && context.recoveryCase.previousAttempts > 0) {
    reasons.push(
      `Retry probability is reduced by ${context.recoveryCase.previousAttempts} previous attempt(s).`
    );
  }
  if (action === "OFFER_DISCOUNT") {
    reasons.push(
      `Discount cost uses the configured ${(context.policy.discountRate * 100).toFixed(2)}% rate.`
    );
  }

  return {
    action,
    appropriate: true,
    recoveryProbability,
    expectedRecoveredAmount,
    estimatedActionCost,
    discountCost,
    expectedNetRecovery,
    score,
    requiresApproval:
      context.recoveryCase.amountAtRisk >=
      context.policy.highValueApprovalThresholdPaise,
    reasons
  };
};
