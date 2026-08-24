import { assertIntegerPaise } from "./recoveryCase.js";
import { recoveryActions, type RecoveryAction } from "../actions/recoveryActions.js";

export interface RecoveryPolicy {
  maximumAutomaticAttempts: number;
  highValueApprovalThresholdPaise: number;
  maximumDiscountRate: number;
  discountRate: number;
  fixedActionCostsPaise: Record<RecoveryAction, number>;
  minimumExpectedNetRecoveryPaise: number;
  allowDiscounts: boolean;
}

/**
 * Synthetic configuration assumptions for deterministic development evaluation.
 * These values are not claims about production payment or messaging costs.
 */
export const defaultRecoveryPolicy: RecoveryPolicy = {
  maximumAutomaticAttempts: 3,
  highValueApprovalThresholdPaise: 100_000_000,
  maximumDiscountRate: 0.1,
  discountRate: 0.1,
  fixedActionCostsPaise: {
    RETRY_PAYMENT: 100,
    SEND_REMINDER: 50,
    CREATE_PAYMENT_LINK: 200,
    OFFER_DISCOUNT: 0,
    STOP: 0
  },
  minimumExpectedNetRecoveryPaise: 0,
  allowDiscounts: true
};

export const validateRecoveryPolicy = (policy: RecoveryPolicy): void => {
  if (!Number.isInteger(policy.maximumAutomaticAttempts) || policy.maximumAutomaticAttempts < 0) {
    throw new Error("maximumAutomaticAttempts must be a non-negative integer");
  }

  assertIntegerPaise(
    policy.highValueApprovalThresholdPaise,
    "highValueApprovalThresholdPaise"
  );
  assertIntegerPaise(
    policy.minimumExpectedNetRecoveryPaise,
    "minimumExpectedNetRecoveryPaise"
  );

  for (const [fieldName, value] of [
    ["maximumDiscountRate", policy.maximumDiscountRate],
    ["discountRate", policy.discountRate]
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${fieldName} must be between 0 and 1`);
    }
  }

  if (policy.discountRate > policy.maximumDiscountRate) {
    throw new Error("discountRate cannot exceed maximumDiscountRate");
  }

  if (typeof policy.allowDiscounts !== "boolean") {
    throw new Error("allowDiscounts must be a boolean");
  }

  for (const action of recoveryActions) {
    assertIntegerPaise(policy.fixedActionCostsPaise[action], `fixedActionCostsPaise.${action}`);
  }
};
