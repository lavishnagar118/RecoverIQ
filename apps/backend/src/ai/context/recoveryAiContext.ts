import type { RecoveryCaseInput } from "../../recovery/domain/recoveryCase.js";
import { selectRecoveryAction } from "../../recovery/decision/recoveryActionEngine.js";
import type { RecoveryPolicy } from "../../recovery/domain/recoveryPolicy.js";
import { scoreRecoveryCase } from "../../recovery/scoring/baselineScoring.js";
import type { RecoveryAiContext } from "../types.js";

export const buildRecoveryAiContext = (
  recoveryCase: RecoveryCaseInput,
  recoveryPolicy: RecoveryPolicy
): RecoveryAiContext => {
  const baseline = scoreRecoveryCase(recoveryCase);
  const deterministicDecision = selectRecoveryAction(recoveryCase, recoveryPolicy);

  return {
    case: {
      caseId: recoveryCase.caseId,
      amountAtRisk: recoveryCase.amountAtRisk,
      currency: recoveryCase.currency,
      scenarioType: recoveryCase.scenarioType,
      failureReason: recoveryCase.failureReason,
      previousAttempts: recoveryCase.previousAttempts,
      checkoutStatus: recoveryCase.checkoutStatus,
      status: recoveryCase.status,
      createdAt: recoveryCase.createdAt,
      updatedAt: recoveryCase.updatedAt
    },
    customerHistory: { ...recoveryCase.customerHistory },
    baseline: {
      recoveryProbability: baseline.recoveryProbability,
      expectedRecoveryValuePaise: baseline.expectedRecoveryValue,
      reasons: baseline.reasons
    },
    deterministicDecision,
    recoveryPolicy: {
      ...recoveryPolicy,
      fixedActionCostsPaise: { ...recoveryPolicy.fixedActionCostsPaise }
    },
    dataClassification: "synthetic"
  };
};
