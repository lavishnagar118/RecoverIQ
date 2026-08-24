import { z } from "zod";

import type { RecoveryCaseInput } from "../../recovery/domain/recoveryCase.js";
import type { RecoveryActionDecision } from "../../recovery/decision/recoveryActionEngine.js";
import {
  recoveryAiRecommendationSchema,
  type RecoveryAiRecommendation
} from "../schemas/recoveryAiRecommendation.js";

export type AiValidationCode =
  | "VALID"
  | "SCHEMA_INVALID"
  | "SEMANTIC_INVALID"
  | "CONFLICT"
  | "ABSTAINED"
  | "UNSAFE_MESSAGE";

export interface ValidatedAiRecommendation {
  recommendation: RecoveryAiRecommendation;
  code: AiValidationCode;
  warnings: string[];
}

const unsafeMessagePatterns = [
  /\b(?:password|passcode|credential|otp|one[- ]time password|pin|cvv|cvc|security code)\b/i,
  /\b(?:card|bank|upi)\b.{0,30}\b(?:number|details|secret|code|pin|password)\b/i,
  /\b(?:share|send|provide|tell us|enter|confirm)\b.{0,30}\b(?:card|bank|upi|password|otp|pin|cvv|credential)\b/i,
  /\b(?:guarantee(?:d)?|definitely|certainly|will succeed|will go through|success(?:ful|fully))\b/i,
  /\b(?:immediately|urgent(?:ly)?|act now|last warning|must pay|pay now|do not delay)\b/i,
  /\b(?:suspend(?:ed|ion)?|terminate|close|block(?:ed)?|legal action|penalty)\b/i,
  /\b(?:https?:\/\/|www\.|(?:bit\.ly|tinyurl\.com|t\.co)\/)\b/i,
  /\b(?:click|tap|open|visit|download|install)\b.{0,40}\b(?:link|url|app|site|portal)\b/i,
  /\b(?:leave|outside|separate from|another)\b.{0,30}\b(?:checkout|payment flow|app|website)\b/i,
  /<[^>]+>/i,
  /[\r\n]/,
  /\brefund\b/i
];

const approvedMessageShape =
  /^(?:We (?:couldn't|could not|were unable to) complete your (?:payment|checkout)|Your (?:payment|checkout) could not be completed|Please try again|You can try again|Please return to checkout)\b[^.!?]{0,180}[.!?]?$/i;

export const isSafeCustomerMessage = (message: string): boolean => {
  const trimmed = message.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 240 &&
    approvedMessageShape.test(trimmed) &&
    !unsafeMessagePatterns.some((pattern) => pattern.test(trimmed))
  );
};

export const validateRecoveryAiOutput = (
  output: unknown,
  recoveryCase: RecoveryCaseInput,
  deterministicDecision: RecoveryActionDecision
): ValidatedAiRecommendation => {
  const parsed = recoveryAiRecommendationSchema.safeParse(output);
  if (!parsed.success) {
    return {
      recommendation: buildFallbackShape(parsed.error),
      code: "SCHEMA_INVALID",
      warnings: ["AI output failed strict schema validation."]
    };
  }

  const recommendation = parsed.data;
  const warnings = [...recommendation.warnings];

  if (
    recommendation.abstain ||
    recommendation.confidence < 0.5 ||
    recommendation.recommendedAction === "STOP" ||
    recoveryCase.customerHistory.optedOut ||
    recoveryCase.status === "CUSTOMER_OPTED_OUT" ||
    ["RECOVERED", "STOPPED", "EXPIRED", "CANCELLED"].includes(recoveryCase.status)
  ) {
    return {
      recommendation: {
        ...recommendation,
        customerMessage: null,
        ...(recommendation.abstain || recommendation.confidence < 0.5
          ? { recommendedAction: null, abstain: true, decisionStrength: "ABSTAIN" as const }
          : {})
      },
      code:
        recommendation.abstain || recommendation.confidence < 0.5
          ? "ABSTAINED"
          : "SEMANTIC_INVALID",
      warnings: [
        ...warnings,
        recommendation.abstain || recommendation.confidence < 0.5
          ? "AI recommendation was abstained due to low confidence or explicit abstention."
          : "Customer communication is not eligible for this recovery case."
      ]
    };
  }

  if (recommendation.customerMessage && !isSafeCustomerMessage(recommendation.customerMessage)) {
    return {
      recommendation: { ...recommendation, customerMessage: null },
      code: "UNSAFE_MESSAGE",
      warnings: [...warnings, "AI customer message failed safety validation."]
    };
  }

  if (
    recommendation.recommendedAction &&
    !deterministicDecision.candidates.some(
      (candidate) => candidate.action === recommendation.recommendedAction && candidate.appropriate
    )
  ) {
    return {
      recommendation,
      code: "SEMANTIC_INVALID",
      warnings: [...warnings, "AI recommended an action that is not an eligible deterministic candidate."]
    };
  }

  if (
    recommendation.recommendedAction &&
    recommendation.recommendedAction !== deterministicDecision.selectedAction
  ) {
    return {
      recommendation,
      code: "CONFLICT",
      warnings: [...warnings, "AI recommendation conflicts with the deterministic selected action."]
    };
  }

  return { recommendation, code: "VALID", warnings };
};

const buildFallbackShape = (error: z.ZodError): RecoveryAiRecommendation => ({
  schemaVersion: "1",
  diagnosis: {
    primaryCause: "UNKNOWN",
    summary: "AI output was unavailable for this case.",
    keyFactors: []
  },
  recommendedAction: null,
  recommendationReason: "The deterministic recovery engine remains authoritative.",
  customerMessage: null,
  confidence: 0,
  decisionStrength: "ABSTAIN",
  abstain: true,
  toolRequests: [],
  warnings: [`Schema validation issue: ${error.issues.length} field(s) rejected.`],
  limitations: ["No validated AI recommendation is available."]
});
