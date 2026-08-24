import { env } from "../../config/env.js";
import { defaultRecoveryPolicy } from "../../recovery/domain/recoveryPolicy.js";
import type { RecoveryCaseInput } from "../../recovery/domain/recoveryCase.js";
import { selectRecoveryAction } from "../../recovery/decision/recoveryActionEngine.js";
import { buildDeterministicFallback } from "../fallback/deterministicFallback.js";
import { buildRecoveryAiContext } from "../context/recoveryAiContext.js";
import { recoveryAiDeveloperPrompt, recoveryAiSystemPrompt } from "../prompts/recoveryPrompts.js";
import { recoveryAiRecommendationJsonSchema } from "../schemas/recoveryAiRecommendation.js";
import { recoveryReadOnlyTools } from "../tools/recoveryReadTools.js";
import type { AiProvider } from "../types.js";
import { validateRecoveryAiOutput, type AiValidationCode } from "../validation/recoveryAiValidation.js";

export interface RecoveryAdvisoryResult {
  source: "AI" | "DETERMINISTIC_FALLBACK";
  validationCode: AiValidationCode | "AI_DISABLED" | "PROVIDER_ERROR";
  recommendation: ReturnType<typeof buildDeterministicFallback>;
  deterministicAction: ReturnType<typeof selectRecoveryAction>["selectedAction"];
  aiAction: ReturnType<typeof buildDeterministicFallback>["recommendedAction"];
  latencyMs: number;
}

export class ControlledRecoveryAgent {
  constructor(
    private readonly provider?: AiProvider,
    private readonly options: {
      enabled?: boolean;
      timeoutMs?: number;
      maxOutputTokens?: number;
    } = {}
  ) {}

  async advise(recoveryCase: RecoveryCaseInput): Promise<RecoveryAdvisoryResult> {
    const decision = selectRecoveryAction(recoveryCase, defaultRecoveryPolicy);
    const fallback = (code: RecoveryAdvisoryResult["validationCode"], warning: string): RecoveryAdvisoryResult => ({
      source: "DETERMINISTIC_FALLBACK",
      validationCode: code,
      recommendation: buildDeterministicFallback(recoveryCase, decision, warning),
      deterministicAction: decision.selectedAction,
      aiAction: null,
      latencyMs: 0
    });

    if (!(this.options.enabled ?? env.ai.enabled) || !this.provider) {
      return fallback("AI_DISABLED", "AI advisory mode is disabled or no provider is configured.");
    }

    const startedAt = Date.now();
    try {
      const context = buildRecoveryAiContext(recoveryCase, defaultRecoveryPolicy);
      const result = await this.provider.generateStructured({
        systemPrompt: recoveryAiSystemPrompt,
        developerPrompt: recoveryAiDeveloperPrompt,
        context,
        outputSchema: recoveryAiRecommendationJsonSchema,
        tools: recoveryReadOnlyTools,
        timeoutMs: this.options.timeoutMs ?? env.ai.requestTimeoutMs,
        maxOutputTokens: this.options.maxOutputTokens ?? env.ai.maxOutputTokens
      });
      const validated = validateRecoveryAiOutput(result.output, recoveryCase, decision);

      if (validated.code === "VALID" || validated.code === "CONFLICT") {
        return {
          source: "AI",
          validationCode: validated.code,
          recommendation: validated.recommendation,
          deterministicAction: decision.selectedAction,
          aiAction: validated.recommendation.recommendedAction,
          latencyMs: Date.now() - startedAt
        };
      }

      return fallback(validated.code, validated.warnings.join(" "));
    } catch {
      return fallback("PROVIDER_ERROR", "AI provider failed; deterministic recovery analysis was retained.");
    }
  }
}
