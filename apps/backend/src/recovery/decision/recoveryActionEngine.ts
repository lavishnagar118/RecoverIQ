import { recoveryActions, type RecoveryAction } from "../actions/recoveryActions.js";
import {
  defaultRecoveryPolicy,
  type RecoveryPolicy,
  validateRecoveryPolicy
} from "../domain/recoveryPolicy.js";
import { isTerminalRecoveryStatus } from "../domain/recoveryState.js";
import type { RecoveryCaseInput } from "../domain/recoveryCase.js";
import { scoreRecoveryCase } from "../scoring/baselineScoring.js";
import {
  scoreRecoveryAction,
  type RecoveryActionCandidate
} from "./actionScoring.js";

export interface RecoveryActionDecision {
  caseId: string;
  candidates: RecoveryActionCandidate[];
  selectedAction: RecoveryAction;
  selectedCandidate: RecoveryActionCandidate;
  decisionStrength: "STRONG" | "MODERATE" | "WEAK" | "STOP";
  reasons: string[];
}

export const compareRecoveryActionCandidates = (
  left: RecoveryActionCandidate,
  right: RecoveryActionCandidate
): number => {
  if (left.expectedNetRecovery !== right.expectedNetRecovery) {
    return right.expectedNetRecovery - left.expectedNetRecovery;
  }

  if (left.recoveryProbability !== right.recoveryProbability) {
    return right.recoveryProbability - left.recoveryProbability;
  }

  if (left.estimatedActionCost !== right.estimatedActionCost) {
    return left.estimatedActionCost - right.estimatedActionCost;
  }

  return recoveryActions.indexOf(left.action) - recoveryActions.indexOf(right.action);
};

const decisionEligibleStatuses = ["AT_RISK", "ANALYZING", "FAILED"] as const;

const isDecisionEligibleStatus = (
  status: RecoveryCaseInput["status"]
): boolean => decisionEligibleStatuses.includes(status as (typeof decisionEligibleStatuses)[number]);

// These thresholds are deterministic presentation assumptions, not calibrated production confidence bands.
const decisionStrength = (
  candidate: RecoveryActionCandidate
): RecoveryActionDecision["decisionStrength"] => {
  if (candidate.action === "STOP") {
    return "STOP";
  }

  if ((candidate.score ?? 0) >= 0.7) {
    return "STRONG";
  }

  if ((candidate.score ?? 0) >= 0.4) {
    return "MODERATE";
  }

  return "WEAK";
};

export const selectRecoveryAction = (
  recoveryCase: RecoveryCaseInput,
  policy: RecoveryPolicy = defaultRecoveryPolicy
): RecoveryActionDecision => {
  validateRecoveryPolicy(policy);

  if (
    !isTerminalRecoveryStatus(recoveryCase.status) &&
    !isDecisionEligibleStatus(recoveryCase.status)
  ) {
    throw new Error(
      `Recovery action selection is not eligible while case is in status ${recoveryCase.status}.`
    );
  }

  const baselineScore = scoreRecoveryCase(recoveryCase);
  const candidates = recoveryActions.map((action) =>
    scoreRecoveryAction(action, {
      recoveryCase,
      baselineScore,
      policy
    })
  );
  const stopCandidate = candidates.find((candidate) => candidate.action === "STOP");

  if (!stopCandidate) {
    throw new Error("STOP candidate must always be generated");
  }

  const eligibleCandidates = candidates
    .filter(
      (candidate) =>
        candidate.action !== "STOP" &&
        candidate.appropriate &&
        candidate.expectedNetRecovery > policy.minimumExpectedNetRecoveryPaise
    )
    .sort(compareRecoveryActionCandidates);

  const selectedCandidate =
    isTerminalRecoveryStatus(recoveryCase.status) || eligibleCandidates.length === 0
      ? stopCandidate
      : eligibleCandidates[0];

  const reasons =
    selectedCandidate.action === "STOP"
      ? [
          ...selectedCandidate.reasons,
          isTerminalRecoveryStatus(recoveryCase.status)
            ? "Terminal recovery status requires STOP."
            : `No non-STOP candidate exceeded the minimum expected net recovery of ${policy.minimumExpectedNetRecoveryPaise} paise.`
        ]
      : [
          ...selectedCandidate.reasons,
          `Selected ${selectedCandidate.action} as the highest-ranked valid candidate by expected net recovery.`
        ];

  return {
    caseId: recoveryCase.caseId,
    candidates,
    selectedAction: selectedCandidate.action,
    selectedCandidate,
    decisionStrength: decisionStrength(selectedCandidate),
    reasons
  };
};
