export const recoveryScenarioTypes = ["PAYMENT_FAILED", "CHECKOUT_ABANDONED"] as const;

export type RecoveryScenarioType = (typeof recoveryScenarioTypes)[number];

export const recoveryStatuses = [
  "AT_RISK",
  "ANALYZING",
  "ACTION_SELECTED",
  "AWAITING_APPROVAL",
  "ACTION_EXECUTED",
  "WAITING_RESULT",
  "RECOVERED",
  "STOPPED",
  "EXPIRED",
  "CANCELLED",
  "CUSTOMER_OPTED_OUT",
  "FAILED"
] as const;

export type RecoveryStatus = (typeof recoveryStatuses)[number];

export const checkoutStatuses = [
  "NOT_STARTED",
  "STARTED",
  "PAYMENT_INITIATED",
  "PAYMENT_FAILED",
  "ABANDONED_BEFORE_PAYMENT",
  "ABANDONED_AFTER_PAYMENT",
  "COMPLETED"
] as const;

export type CheckoutStatus = (typeof checkoutStatuses)[number];

export const failureReasons = [
  "INSUFFICIENT_FUNDS",
  "BANK_DECLINED",
  "NETWORK_ERROR",
  "AUTHENTICATION_FAILED",
  "LIMIT_EXCEEDED",
  "USER_ABANDONED",
  "PRICE_SHOCK",
  "PAYMENT_METHOD_UNAVAILABLE",
  "CHECKOUT_TIMEOUT",
  "UNKNOWN"
] as const;

export type FailureReason = (typeof failureReasons)[number];

export const INR_PAISE_PER_RUPEE = 100;

export const assertIntegerPaise = (value: number, fieldName: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer paise amount`);
  }
};

export const inrRupeesToPaise = (rupees: number): number => {
  if (!Number.isSafeInteger(rupees) || rupees < 0) {
    throw new Error("rupees must be a non-negative safe integer");
  }

  const paise = rupees * INR_PAISE_PER_RUPEE;
  assertIntegerPaise(paise, "paise");

  return paise;
};

export interface CustomerHistory {
  successfulPayments: number;
  failedPayments: number;
  chargebacks: number;
  daysSinceLastSuccessfulPayment?: number;
  /** Stored as integer INR paise. */
  lifetimeValue: number;
  isRepeatCustomer: boolean;
  optedOut: boolean;
}

export interface RecoveryCaseInput {
  caseId: string;
  customerId: string;
  /** Stored as integer INR paise. */
  amountAtRisk: number;
  currency: "INR";
  scenarioType: RecoveryScenarioType;
  failureReason: FailureReason;
  customerHistory: CustomerHistory;
  previousAttempts: number;
  checkoutStatus: CheckoutStatus;
  status: RecoveryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedRecoveryCase extends RecoveryCaseInput {
  recoveryProbability?: number;
  expectedRecoveryValue?: number;
  scoringReasons?: string[];
  selectedAction?: import("../actions/recoveryActions.js").RecoveryAction;
  recoveredAmountPaise?: number;
  recoveredPaymentId?: string;
}

export interface RecoveryCase extends RecoveryCaseInput {
  recoveryProbability: number;
  /** Stored as integer INR paise. */
  expectedRecoveryValue: number;
  scoringReasons: string[];
}

export const calculateExpectedRecoveryValue = (
  amountAtRisk: number,
  recoveryProbability: number
): number => {
  assertIntegerPaise(amountAtRisk, "amountAtRisk");

  if (!Number.isFinite(recoveryProbability) || recoveryProbability < 0 || recoveryProbability > 1) {
    throw new Error("recoveryProbability must be between 0 and 1");
  }

  const expectedRecoveryValue = Math.round(amountAtRisk * recoveryProbability);
  assertIntegerPaise(expectedRecoveryValue, "expectedRecoveryValue");

  return expectedRecoveryValue;
};

export const calculateTotalAmountAtRisk = (cases: readonly Pick<RecoveryCaseInput, "amountAtRisk">[]) =>
  cases.reduce((total, recoveryCase) => {
    assertIntegerPaise(recoveryCase.amountAtRisk, "amountAtRisk");

    const nextTotal = total + recoveryCase.amountAtRisk;
    assertIntegerPaise(nextTotal, "totalAmountAtRisk");

    return nextTotal;
  }, 0);
