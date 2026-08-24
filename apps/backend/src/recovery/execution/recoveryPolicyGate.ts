import { type RecoveryCaseInput, assertIntegerPaise } from "../domain/recoveryCase.js";
import { isTerminalRecoveryStatus } from "../domain/recoveryState.js";
import type { RecoveryPolicy } from "../domain/recoveryPolicy.js";

export const validatePaymentLinkExecution = (
  recoveryCase: RecoveryCaseInput,
  policy: RecoveryPolicy,
  attemptNumber: number,
  requiresApproval: boolean,
  approved: boolean
): void => {
  if (recoveryCase.status !== "ACTION_SELECTED" && recoveryCase.status !== "FAILED") {
    throw new Error(`CREATE_PAYMENT_LINK is not eligible from status ${recoveryCase.status}`);
  }
  if (isTerminalRecoveryStatus(recoveryCase.status)) {
    throw new Error(`Recovery case ${recoveryCase.caseId} is terminal`);
  }
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > policy.maximumAutomaticAttempts) {
    throw new Error("Recovery attempt limit exceeded");
  }
  assertIntegerPaise(recoveryCase.amountAtRisk, "amountAtRisk");
  if (recoveryCase.amountAtRisk <= 0 || recoveryCase.currency !== "INR") {
    throw new Error("Recovery case has an invalid INR amount");
  }
  if (requiresApproval && !approved) {
    throw new Error("Merchant approval is required for this recovery action");
  }
};
