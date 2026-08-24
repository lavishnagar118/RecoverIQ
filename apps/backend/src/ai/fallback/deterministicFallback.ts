import type { RecoveryCaseInput } from "../../recovery/domain/recoveryCase.js";
import type { RecoveryActionDecision } from "../../recovery/decision/recoveryActionEngine.js";
import type { RecoveryAiRecommendation } from "../schemas/recoveryAiRecommendation.js";

export const buildDeterministicFallback = (
  recoveryCase: RecoveryCaseInput,
  decision: RecoveryActionDecision,
  warning: string
): RecoveryAiRecommendation => ({
  schemaVersion: "1",
  diagnosis: {
    primaryCause: recoveryCase.failureReason,
    summary: `Deterministic recovery analysis selected ${decision.selectedAction}.`,
    keyFactors: decision.reasons.slice(0, 8)
  },
  recommendedAction: decision.selectedAction,
  recommendationReason: decision.reasons.join(" "),
  customerMessage:
    decision.selectedAction === "STOP" ||
    recoveryCase.customerHistory.optedOut ||
    recoveryCase.status === "CUSTOMER_OPTED_OUT"
      ? null
      : "We couldn't complete your checkout. Please try again when convenient.",
  confidence: 1,
  decisionStrength: decision.decisionStrength,
  abstain: false,
  toolRequests: [],
  warnings: [warning],
  limitations: ["This is a deterministic fallback; no validated AI output was used."]
});
