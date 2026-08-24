import {
  type CheckoutStatus,
  type CustomerHistory,
  type FailureReason,
  inrRupeesToPaise,
  type RecoveryCase,
  type RecoveryCaseInput,
  type RecoveryScenarioType,
  type RecoveryStatus
} from "../domain/recoveryCase.js";
import { applyRecoveryScore } from "../scoring/baselineScoring.js";
import { SeededRandom } from "./seededRandom.js";

export const defaultSyntheticRecoverySeed = 20_260_821;
export const defaultSyntheticRecoveryBatchSize = 1_000;

export const syntheticOutcomeLabels = [
  "SIMULATED_WOULD_RECOVER",
  "SIMULATED_WOULD_NOT_RECOVER",
  "SIMULATED_REQUIRES_REVIEW",
  "SIMULATED_SHOULD_STOP",
  "SIMULATED_UNRESOLVED"
] as const;

export type SyntheticOutcomeLabel = (typeof syntheticOutcomeLabels)[number];

export interface SyntheticRecoveryMetadata {
  datasetType: "synthetic";
  seed: number;
  index: number;
  simulatedOutcomeLabel: SyntheticOutcomeLabel;
}

export type SyntheticRecoveryCase = RecoveryCase & {
  syntheticMetadata: SyntheticRecoveryMetadata;
};

const paymentFailureReasons: readonly FailureReason[] = [
  "INSUFFICIENT_FUNDS",
  "BANK_DECLINED",
  "NETWORK_ERROR",
  "AUTHENTICATION_FAILED",
  "LIMIT_EXCEEDED",
  "UNKNOWN"
];

const checkoutFailureReasons: readonly FailureReason[] = [
  "USER_ABANDONED",
  "PRICE_SHOCK",
  "PAYMENT_METHOD_UNAVAILABLE",
  "CHECKOUT_TIMEOUT",
  "NETWORK_ERROR",
  "UNKNOWN"
];

const checkoutStatusByScenario: Record<RecoveryScenarioType, readonly CheckoutStatus[]> = {
  PAYMENT_FAILED: ["PAYMENT_INITIATED", "PAYMENT_FAILED"],
  CHECKOUT_ABANDONED: ["STARTED", "ABANDONED_BEFORE_PAYMENT", "ABANDONED_AFTER_PAYMENT"]
};

const fixedBaseTime = Date.UTC(2026, 0, 1, 0, 0, 0);

const buildTimestamp = (index: number, offsetMinutes: number): string =>
  new Date(fixedBaseTime + (index * 11 + offsetMinutes) * 60_000).toISOString();

const randomRupeesAsPaise = (
  random: SeededRandom,
  minimumRupees: number,
  maximumRupees: number
): number => inrRupeesToPaise(random.nextInt(minimumRupees, maximumRupees));

const buildAmountAtRisk = (index: number, random: SeededRandom): number => {
  if (index % 20 === 0) {
    return randomRupeesAsPaise(random, 500_000, 2_500_000);
  }

  if (index % 7 === 0) {
    return randomRupeesAsPaise(random, 80_000, 250_000);
  }

  return randomRupeesAsPaise(random, 5_000, 75_000);
};

const buildPreviousAttempts = (index: number, random: SeededRandom): number => {
  if (index % 13 === 0) {
    return random.nextInt(3, 5);
  }

  if (index % 5 === 0) {
    return 2;
  }

  return random.nextInt(0, 1);
};

const buildCustomerHistory = (
  index: number,
  amountAtRisk: number,
  previousAttempts: number,
  random: SeededRandom
): CustomerHistory => {
  const successfulPayments = index % 11 === 0 ? 0 : random.nextInt(0, 12);
  const failedPayments = previousAttempts + (index % 17 === 0 ? random.nextInt(2, 4) : random.nextInt(0, 1));
  const chargebacks = index % 97 === 0 ? 1 : 0;
  const optedOut = index % 89 === 0;
  const lifetimeValue =
    successfulPayments * randomRupeesAsPaise(random, 8_000, Math.max(8_000, amountAtRisk / 100));

  return {
    successfulPayments,
    failedPayments,
    chargebacks,
    daysSinceLastSuccessfulPayment:
      successfulPayments > 0 ? random.nextInt(1, 180) : undefined,
    lifetimeValue,
    isRepeatCustomer: successfulPayments >= 2,
    optedOut
  };
};

const buildStatus = (
  index: number,
  previousAttempts: number,
  customerHistory: CustomerHistory
): RecoveryStatus => {
  if (customerHistory.optedOut) {
    return "CUSTOMER_OPTED_OUT";
  }

  if (index % 41 === 0) {
    return "EXPIRED";
  }

  if (previousAttempts >= 3 && index % 2 === 0) {
    return "STOPPED";
  }

  if (index % 17 === 0) {
    return "FAILED";
  }

  if (index % 23 === 0) {
    return "WAITING_RESULT";
  }

  if (index % 19 === 0) {
    return "ANALYZING";
  }

  return "AT_RISK";
};

const deriveSyntheticOutcomeLabel = (
  input: RecoveryCaseInput,
  index: number
): SyntheticOutcomeLabel => {
  if (
    input.status === "STOPPED" ||
    input.status === "EXPIRED" ||
    input.status === "CUSTOMER_OPTED_OUT" ||
    input.previousAttempts >= 3
  ) {
    return "SIMULATED_SHOULD_STOP";
  }

  if (input.amountAtRisk >= inrRupeesToPaise(1_000_000)) {
    return "SIMULATED_REQUIRES_REVIEW";
  }

  if (
    input.customerHistory.isRepeatCustomer &&
    input.previousAttempts <= 1 &&
    ["NETWORK_ERROR", "CHECKOUT_TIMEOUT", "AUTHENTICATION_FAILED"].includes(input.failureReason)
  ) {
    return "SIMULATED_WOULD_RECOVER";
  }

  if (
    input.customerHistory.successfulPayments === 0 ||
    input.customerHistory.failedPayments >= 4 ||
    input.failureReason === "PRICE_SHOCK" ||
    input.failureReason === "INSUFFICIENT_FUNDS"
  ) {
    return "SIMULATED_WOULD_NOT_RECOVER";
  }

  return index % 3 === 0 ? "SIMULATED_WOULD_RECOVER" : "SIMULATED_UNRESOLVED";
};

export const generateSyntheticRecoveryCases = (
  count = defaultSyntheticRecoveryBatchSize,
  seed = defaultSyntheticRecoverySeed
): SyntheticRecoveryCase[] => {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("Synthetic recovery case count must be a non-negative integer");
  }

  const random = new SeededRandom(seed);

  return Array.from({ length: count }, (_, index) => {
    const scenarioType: RecoveryScenarioType =
      index % 3 === 0 ? "CHECKOUT_ABANDONED" : random.pick(["PAYMENT_FAILED", "CHECKOUT_ABANDONED"]);
    const amountAtRisk = buildAmountAtRisk(index, random);
    const previousAttempts = buildPreviousAttempts(index, random);
    const failureReason = random.pick(
      scenarioType === "PAYMENT_FAILED" ? paymentFailureReasons : checkoutFailureReasons
    );
    const customerHistory = buildCustomerHistory(index, amountAtRisk, previousAttempts, random);
    const checkoutStatus = random.pick(checkoutStatusByScenario[scenarioType]);
    const status = buildStatus(index, previousAttempts, customerHistory);

    const input: RecoveryCaseInput = {
      caseId: `case_${seed}_${String(index + 1).padStart(4, "0")}`,
      customerId: `cust_${String((index % 250) + 1).padStart(4, "0")}`,
      amountAtRisk,
      currency: "INR",
      scenarioType,
      failureReason,
      customerHistory,
      previousAttempts,
      checkoutStatus,
      status,
      createdAt: buildTimestamp(index, 0),
      updatedAt: buildTimestamp(index, previousAttempts * 13)
    };

    return {
      ...applyRecoveryScore(input),
      syntheticMetadata: {
        datasetType: "synthetic",
        seed,
        index,
        simulatedOutcomeLabel: deriveSyntheticOutcomeLabel(input, index)
      }
    };
  });
};
