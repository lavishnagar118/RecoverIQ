import type { RecoveryCaseInput } from "../recovery/domain/recoveryCase.js";
import type { RecoveryActionDecision } from "../recovery/decision/recoveryActionEngine.js";
import type { RecoveryPolicy } from "../recovery/domain/recoveryPolicy.js";

export interface AiProviderRequest {
  systemPrompt: string;
  developerPrompt: string;
  context: unknown;
  outputSchema: unknown;
  tools: readonly AiToolDefinition[];
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface AiProviderResult {
  output: unknown;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface AiProvider {
  generateStructured(request: AiProviderRequest): Promise<AiProviderResult>;
}

export interface AiToolDefinition {
  name:
    | "getRecoveryCase"
    | "getCustomerHistory"
    | "getBaselineDecision"
    | "getActionCandidates"
    | "getRecoveryPolicy";
  description: string;
  readOnly: true;
  inputSchema: Record<string, unknown>;
}

export interface RecoveryAiContext {
  case: Pick<
    RecoveryCaseInput,
    | "caseId"
    | "amountAtRisk"
    | "currency"
    | "scenarioType"
    | "failureReason"
    | "previousAttempts"
    | "checkoutStatus"
    | "status"
    | "createdAt"
    | "updatedAt"
  >;
  customerHistory: RecoveryCaseInput["customerHistory"];
  baseline: {
    recoveryProbability: number;
    expectedRecoveryValuePaise: number;
    reasons: string[];
  };
  deterministicDecision: RecoveryActionDecision;
  recoveryPolicy: RecoveryPolicy;
  dataClassification: "synthetic";
}
