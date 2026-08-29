import { z } from "zod";
import { randomUUID } from "node:crypto";

import { env } from "../../config/env.js";
import type { AuditEvent, AuditRepository } from "../../audit/auditEvent.js";
import { defaultRecoveryPolicy } from "../../recovery/domain/recoveryPolicy.js";
import type { RecoveryAction } from "../../recovery/actions/recoveryActions.js";
import type { PersistedRecoveryCase } from "../../recovery/domain/recoveryCase.js";
import type { RecoveryExecution, RecoveryExecutionRepository } from "../../recovery/execution/recoveryExecution.js";
import type { RecoveryCaseRepository } from "../../recovery/persistence/recoveryCaseRepository.js";
import { selectRecoveryAction, type RecoveryActionDecision } from "../../recovery/decision/recoveryActionEngine.js";
import { scoreRecoveryCase } from "../../recovery/scoring/baselineScoring.js";
import { createConfiguredAiProvider } from "../providers/configuredAiProvider.js";
import type { AiProvider } from "../types.js";

export const conversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2_000)
}).strict();

export const assistantRequestSchema = z.object({
  caseId: z.string().trim().min(1).max(120).optional(),
  messages: z.array(conversationMessageSchema).min(1).max(30)
}).strict();

const assistantOutputSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
  intent: z.enum(["ANALYZE_CASE", "EXPLAIN_POLICY", "RECOVER_CASE", "GENERAL_SUMMARY", "FOLLOW_UP", "UNKNOWN"]),
  recommendation: z.enum(["RETRY_PAYMENT", "SEND_REMINDER", "CREATE_PAYMENT_LINK", "OFFER_DISCOUNT", "STOP"]).nullable(),
  requiresConfirmation: z.boolean(),
  action: z.enum(["RETRY_PAYMENT", "SEND_REMINDER", "CREATE_PAYMENT_LINK", "OFFER_DISCOUNT", "STOP"]).nullable(),
  reasoning: z.string().trim().max(1_000),
  confidence: z.number().min(0).max(1)
}).strict();

export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;
export type AssistantResponse = {
  available: boolean;
  message: string;
  intent: z.infer<typeof assistantOutputSchema>["intent"] | "UNAVAILABLE";
  recommendation: RecoveryAction | null;
  requiresConfirmation: boolean;
  action: RecoveryAction | null;
  reasoning: string;
  confidence: number;
  policyDecision?: "ALLOWED" | "BLOCKED" | "APPROVAL_REQUIRED" | "NOT_EVALUATED";
  caseId?: string;
  conversationId: string;
};

export type AssistantActionResult = {
  caseId: string;
  action: "CREATE_PAYMENT_LINK";
  status: string;
  executionKey: string;
  paymentLinkStatus?: string;
  razorpayPaymentLinkId?: string;
  shortUrl?: string;
  message: string;
};

export interface RecoveryActionExecutor {
  createPaymentLink(caseId: string): Promise<RecoveryExecution>;
}

interface AssistantContext {
  selectedCase?: {
    caseId: string;
    amountAtRiskPaise: number;
    currency: "INR";
    scenario: string;
    failureReason: string;
    checkoutStatus: string;
    status: string;
    previousAttempts: number;
    customerHistory: PersistedRecoveryCase["customerHistory"];
    scoring: {
      recoveryProbability: number;
      expectedRecoveryValuePaise: number;
      reasons: string[];
    };
    deterministicDecision: RecoveryActionDecision;
    policy: typeof defaultRecoveryPolicy;
    authoritativeFacts: {
      caseStatus: string;
      executionStatus: string | null;
      paymentLinkStatus: string | null;
      amountAtRiskPaise: number;
      paidAmountPaise: number | null;
      previousAttempts: number;
      maximumAutomaticAttempts: number;
      deterministicSelectedAction: RecoveryAction;
      policyDecision: "APPROVED" | "NOT_EVALUATED";
      approvalRequired: boolean;
    };
    executions: Array<{
      action: string;
      status: string;
      amountPaise: number;
      attemptNumber: number;
      paymentLinkId?: string;
      paymentLinkStatus?: string;
      paidAmountPaise?: number;
      failureCode?: string;
      failureMessage?: string;
      createdAt: string;
      updatedAt: string;
    }>;
    auditEvents: Array<Pick<AuditEvent, "eventType" | "actor" | "reason" | "policyDecision" | "outcome" | "createdAt">>;
  };
  cases: Array<{
    caseId: string;
    amountAtRiskPaise: number;
    scenario: string;
    status: string;
    recoveryProbability: number;
    selectedAction: string;
  }>;
  summary: {
    totalCases: number;
    activeCases: number;
    totalAmountAtRiskPaise: number;
  };
  policy: typeof defaultRecoveryPolicy;
}

const systemPrompt = [
  "You are RecoverIQ AI, a revenue recovery assistant for merchants.",
  "Analyze the provided RecoverIQ case context before answering.",
  "Use simple, conversational language.",
  "You must use only authoritative facts supplied in the recovery case context.",
  "Never invent payment status, recovery status, attempt counts, amounts, policy decisions, approval requirements, customer information, execution results, or Razorpay events.",
  "Never say that a limit was reached unless the authoritative context explicitly says so.",
  "Never calculate or infer a policy decision yourself.",
  "The deterministic policy decision supplied by the backend is authoritative.",
  "If the supplied context does not contain enough information, say: I don't have enough information in the recovery case to determine that.",
  "Do not guess.",
  "When explaining a recovery case, explain what happened, what you found, why it happened when the available data supports it, the recommended next step, and why that step is recommended.",
  "You are an advisory assistant.",
  "You cannot override deterministic policy.",
  "You cannot directly access secrets or Razorpay credentials.",
  "Financial/external actions must go through the existing backend tools and deterministic policy gate.",
  "Never claim that a payment was recovered unless the backend confirms successful reconciliation.",
  "Explain the supplied policy decision; do not decide whether an action is allowed or whether approval is required.",
  "Use only the supplied RecoverIQ context and conversation history, and return only the requested structured schema."
].join(" ");

const developerPrompt = [
  "The backend policy gate and RecoveryExecutionService are authoritative.",
  "CREATE_PAYMENT_LINK always requires merchant confirmation in the UI and is executable only when policy allows it.",
  "High-value cases require approval and must not be executed by this assistant.",
  "A created Payment Link is not a recovered payment; only a trusted Razorpay webhook reconciliation can establish recovery.",
  "For unavailable evidence, say that it is unavailable rather than guessing."
].join(" ");

const assistantOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message", "intent", "recommendation", "requiresConfirmation", "action", "reasoning", "confidence"],
  properties: {
    message: {
      type: "string",
      description: "Explain only the supplied authoritative case facts and validated recommendation; do not introduce new facts."
    },
    intent: {
      type: "string",
      enum: ["ANALYZE_CASE", "EXPLAIN_POLICY", "RECOVER_CASE", "GENERAL_SUMMARY", "FOLLOW_UP", "UNKNOWN"],
      description: "The user's conversational intent."
    },
    recommendation: {
      anyOf: [
        {
          type: "string",
          enum: ["RETRY_PAYMENT", "SEND_REMINDER", "CREATE_PAYMENT_LINK", "OFFER_DISCOUNT", "STOP"]
        },
        { type: "null" }
      ],
      description: "The AI recommendation, or null when no recommendation is safe."
    },
    requiresConfirmation: {
      type: "boolean",
      description: "Whether the UI must obtain explicit merchant confirmation before any separately gated action."
    },
    action: {
      anyOf: [
        {
          type: "string",
          enum: ["RETRY_PAYMENT", "SEND_REMINDER", "CREATE_PAYMENT_LINK", "OFFER_DISCOUNT", "STOP"]
        },
        { type: "null" }
      ],
      description: "A proposed action enum, or null; this never authorizes execution."
    },
    reasoning: {
      type: "string",
      description: "Explain why the supplied authoritative facts support the recommendation; do not introduce new facts."
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Model confidence from 0 to 1."
    }
  }
} as const;

const toSafeExecution = (execution: RecoveryExecution) => ({
  action: execution.action,
  status: execution.status,
  amountPaise: execution.amountPaise,
  attemptNumber: execution.attemptNumber,
  paymentLinkId: execution.razorpayPaymentLinkId,
  paymentLinkStatus: execution.paymentLinkStatus,
  paidAmountPaise: execution.paidAmountPaise,
  failureCode: execution.failureCode,
  failureMessage: execution.failureMessage,
  createdAt: execution.createdAt,
  updatedAt: execution.updatedAt
});

export class AssistantUnavailableError extends Error {
  constructor() {
    super("Conversational AI is unavailable because no configured AI provider is available.");
    this.name = "AssistantUnavailableError";
  }
}

export class ConversationalAssistant {
  private readonly provider?: AiProvider;

  constructor(
    private readonly cases: RecoveryCaseRepository,
    private readonly executions: RecoveryExecutionRepository,
    private readonly audit: AuditRepository,
    private readonly executionService: RecoveryActionExecutor,
    provider?: AiProvider
  ) {
    this.provider = arguments.length >= 5 ? provider : createConfiguredAiProvider();
  }

  async respond(request: AssistantRequest): Promise<AssistantResponse> {
    const parsed = assistantRequestSchema.parse(request);
    const context = await this.buildContext(parsed.caseId);
    if (!this.provider) {
      return {
        available: false,
        message: "Conversational AI is unavailable. Configure a supported AI provider before using the chat assistant.",
        intent: "UNAVAILABLE",
        recommendation: null,
        requiresConfirmation: false,
        action: null,
        reasoning: "No configured AI provider is available.",
        confidence: 0,
        policyDecision: "NOT_EVALUATED",
        caseId: parsed.caseId,
        conversationId: randomUUID()
      };
    }

    const result = await this.provider.generateStructured({
      systemPrompt,
      developerPrompt,
      context: { recoveriq: context, conversation: parsed.messages },
      outputSchema: assistantOutputJsonSchema,
      tools: [],
      timeoutMs: env.ai.requestTimeoutMs,
      maxOutputTokens: env.ai.maxOutputTokens
    });
    const question = parsed.messages[parsed.messages.length - 1]?.content ?? "";
    const output = this.groundAssistantOutput(
      this.parseAssistantOutput(result.output, context.selectedCase, question),
      context.selectedCase,
      question
    );
    const policy = this.evaluateAction(output.action, context.selectedCase);

    return {
      available: true,
      message: output.message,
      intent: output.intent,
      recommendation: output.recommendation,
      requiresConfirmation: policy.requiresConfirmation,
      action: policy.action,
      reasoning: output.reasoning,
      confidence: output.confidence,
      policyDecision: policy.decision,
      caseId: parsed.caseId,
      conversationId: randomUUID()
    };
  }

  async confirmAction(caseId: string, action: RecoveryAction): Promise<AssistantActionResult> {
    if (action !== "CREATE_PAYMENT_LINK") {
      throw new Error("This assistant can only execute CREATE_PAYMENT_LINK through the existing recovery service");
    }
    const recoveryCase = await this.cases.getById(caseId);
    if (!recoveryCase) throw new Error(`Recovery case ${caseId} was not found`);
    const decision = selectRecoveryAction(recoveryCase, defaultRecoveryPolicy);
    const candidate = decision.candidates.find((item) => item.action === action);
    if (!candidate?.appropriate || decision.selectedAction !== action) {
      throw new Error("The requested action is blocked by the deterministic policy decision");
    }
    if (recoveryCase.amountAtRisk >= defaultRecoveryPolicy.highValueApprovalThresholdPaise) {
      throw new Error("Merchant approval is required for this high-value recovery action");
    }
    const execution = await this.executionService.createPaymentLink(caseId);
    return {
      caseId,
      action,
      status: execution.status,
      executionKey: execution.executionKey,
      paymentLinkStatus: execution.paymentLinkStatus,
      razorpayPaymentLinkId: execution.razorpayPaymentLinkId,
      shortUrl: execution.shortUrl,
      message: execution.status === "WAITING_RESULT"
        ? "Payment Link created. Recovery will only be marked successful after trusted Razorpay webhook reconciliation."
        : `Payment Link action completed with status ${execution.status}.`
    };
  }

  private async buildContext(caseId?: string): Promise<AssistantContext> {
    const listedCases = await this.cases.list({ limit: 100 });
    const selectedCase = caseId ? await this.cases.getById(caseId) : undefined;
    const selectedContext = selectedCase ? await this.buildSelectedCaseContext(selectedCase) : undefined;
    return {
      selectedCase: selectedContext,
      cases: listedCases.map((item) => {
        const decision = this.safeDecision(item);
        const score = scoreRecoveryCase(item);
        return {
          caseId: item.caseId,
          amountAtRiskPaise: item.amountAtRisk,
          scenario: item.scenarioType,
          status: item.status,
          recoveryProbability: item.recoveryProbability ?? score.recoveryProbability,
          selectedAction: item.selectedAction ?? decision?.selectedAction ?? "STOP"
        };
      }),
      summary: {
        totalCases: listedCases.length,
        activeCases: listedCases.filter((item) => !["RECOVERED", "STOPPED", "EXPIRED", "CANCELLED", "CUSTOMER_OPTED_OUT", "FAILED"].includes(item.status)).length,
        totalAmountAtRiskPaise: listedCases.reduce((total, item) => total + item.amountAtRisk, 0)
      },
      policy: defaultRecoveryPolicy
    };
  }

  private async buildSelectedCaseContext(recoveryCase: PersistedRecoveryCase): Promise<NonNullable<AssistantContext["selectedCase"]>> {
    const decision = this.safeDecision(recoveryCase);
    if (!decision) throw new Error(`Recovery decision is unavailable for case ${recoveryCase.caseId}`);
    const score = scoreRecoveryCase(recoveryCase);
    const executions = await this.executions.list({ caseId: recoveryCase.caseId, limit: 100 });
    const auditEvents = await this.audit.list({ caseId: recoveryCase.caseId, limit: 100 });
    const latest = [...executions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const approvalRequired = recoveryCase.amountAtRisk >= defaultRecoveryPolicy.highValueApprovalThresholdPaise;
    return {
      caseId: recoveryCase.caseId,
      amountAtRiskPaise: recoveryCase.amountAtRisk,
      currency: recoveryCase.currency,
      scenario: recoveryCase.scenarioType,
      failureReason: recoveryCase.failureReason,
      checkoutStatus: recoveryCase.checkoutStatus,
      status: recoveryCase.status,
      previousAttempts: recoveryCase.previousAttempts,
      customerHistory: { ...recoveryCase.customerHistory },
      scoring: {
        recoveryProbability: recoveryCase.recoveryProbability ?? score.recoveryProbability,
        expectedRecoveryValuePaise: recoveryCase.expectedRecoveryValue ?? score.expectedRecoveryValue,
        reasons: recoveryCase.scoringReasons ?? score.reasons
      },
      deterministicDecision: decision,
      policy: defaultRecoveryPolicy,
      authoritativeFacts: {
        caseStatus: recoveryCase.status,
        executionStatus: latest?.status ?? null,
        paymentLinkStatus: latest?.paymentLinkStatus ?? null,
        amountAtRiskPaise: recoveryCase.amountAtRisk,
        paidAmountPaise: latest?.paidAmountPaise ?? recoveryCase.recoveredAmountPaise ?? null,
        previousAttempts: recoveryCase.previousAttempts,
        maximumAutomaticAttempts: defaultRecoveryPolicy.maximumAutomaticAttempts,
        deterministicSelectedAction: decision.selectedAction,
        policyDecision: ["ACTION_SELECTED", "ACTION_EXECUTED", "WAITING_RESULT", "RECOVERED"].includes(recoveryCase.status)
          ? "APPROVED"
          : "NOT_EVALUATED",
        approvalRequired
      },
      executions: executions.map(toSafeExecution),
      auditEvents: auditEvents.map(({ eventType, actor, reason, policyDecision, outcome, createdAt }) => ({
        eventType,
        actor,
        reason,
        policyDecision,
        outcome,
        createdAt
      }))
    };
  }

  private safeDecision(recoveryCase: PersistedRecoveryCase): RecoveryActionDecision | undefined {
    try {
      return selectRecoveryAction(recoveryCase, defaultRecoveryPolicy);
    } catch {
      return undefined;
    }
  }

  private parseAssistantOutput(
    value: unknown,
    selectedCase: AssistantContext["selectedCase"],
    question: string
  ): z.infer<typeof assistantOutputSchema> {
    const parsed = assistantOutputSchema.safeParse(value);
    if (parsed.success) return parsed.data;

    return this.buildGroundedConversationalFallback(
      selectedCase,
      question,
      "UNKNOWN",
      "The local AI response did not match the required structured format. No action was accepted."
    );
  }

  private groundAssistantOutput(
    output: z.infer<typeof assistantOutputSchema>,
    selectedCase: AssistantContext["selectedCase"],
    question: string
  ): z.infer<typeof assistantOutputSchema> {
    if (!selectedCase) return output;
    const facts = selectedCase.authoritativeFacts;
    if (/\bwhat if\b.{0,80}\bnot (?:been )?recovered\b|\bif\b.{0,80}\bnot (?:been )?recovered\b/i.test(question)) {
      return {
        message: `That is hypothetical, and the supplied recovery case does not define the outcome for an unrecovered payment. The current authoritative state is ${facts.caseStatus} with execution status ${facts.executionStatus ?? "unavailable"} and payment status ${facts.paymentLinkStatus ?? "unavailable"}.`,
        intent: output.intent,
        recommendation: null,
        requiresConfirmation: false,
        action: null,
        reasoning: "No counterfactual policy or execution outcome was supplied by the backend.",
        confidence: 0
      };
    }
    const text = `${output.message}\n${output.reasoning}`;
    const attemptsExhausted = facts.previousAttempts < facts.maximumAutomaticAttempts &&
      /\b(?:maximum|automatic|auto(?:matic)?|recovery)?\s*attempts?\b.{0,40}\b(?:exhausted|reached|used all|limit reached)\b/i.test(text);
    const recoveredContradiction = facts.caseStatus === "RECOVERED" &&
      /\b(?:not recovered|unrecovered|not successfully recovered|payment was not successful)\b/i.test(text);
    const approvalContradiction = !facts.approvalRequired &&
      /\bapproval is required\b/i.test(text);
    if (!attemptsExhausted && !recoveredContradiction && !approvalContradiction) return output;

    return this.buildGroundedConversationalFallback(
      selectedCase,
      question,
      output.intent,
      "The model response contradicted authoritative case facts, so its recommendation was rejected."
    );
  }

  private buildGroundedConversationalFallback(
    selectedCase: AssistantContext["selectedCase"],
    question: string,
    intent: z.infer<typeof assistantOutputSchema>["intent"] = "UNKNOWN",
    reasoning = "The response is grounded in backend-authoritative case facts; no unvalidated model claim was used."
  ): z.infer<typeof assistantOutputSchema> {
    if (!selectedCase) {
      return {
        message: "I don't have enough information in the recovery case to determine that.",
        intent,
        recommendation: null,
        requiresConfirmation: false,
        action: null,
        reasoning: "The requested case facts are unavailable.",
        confidence: 0
      };
    }

    const facts = selectedCase.authoritativeFacts;
    const asksForRecommendation = /\b(analy[sz]e|recommend|what should|next step|recover this|recovery strategy)\b/i.test(question);
    const message = /\battempts?\b/i.test(question)
      ? `The case has ${facts.previousAttempts} of ${facts.maximumAutomaticAttempts} automatic attempts recorded.`
      : /\bapproval\b/i.test(question)
        ? `The backend policy says approval required is ${facts.approvalRequired}.`
        : /\bstop\b|\bwhy\b.*\brecover/i.test(question)
          ? `The deterministic policy selected ${facts.deterministicSelectedAction} because the authoritative case status is ${facts.caseStatus}, with execution status ${facts.executionStatus ?? "unavailable"} and payment status ${facts.paymentLinkStatus ?? "unavailable"}.`
          : `The authoritative case facts are: status ${facts.caseStatus}, execution status ${facts.executionStatus ?? "unavailable"}, payment status ${facts.paymentLinkStatus ?? "unavailable"}, amount at risk ${facts.amountAtRiskPaise} paise, and ${facts.previousAttempts} of ${facts.maximumAutomaticAttempts} automatic attempts.`;

    return {
      message,
      intent,
      recommendation: asksForRecommendation ? facts.deterministicSelectedAction : null,
      requiresConfirmation: false,
      action: null,
      reasoning,
      confidence: 0
    };
  }

  private evaluateAction(
    action: RecoveryAction | null,
    selectedCase: AssistantContext["selectedCase"]
  ): { action: RecoveryAction | null; requiresConfirmation: boolean; decision: AssistantResponse["policyDecision"] } {
    if (!action || !selectedCase) return { action: null, requiresConfirmation: false, decision: selectedCase ? "NOT_EVALUATED" : "NOT_EVALUATED" };
    const candidate = selectedCase.deterministicDecision.candidates.find((item) => item.action === action);
    if (!candidate?.appropriate || selectedCase.deterministicDecision.selectedAction !== action) {
      return { action: null, requiresConfirmation: false, decision: "BLOCKED" };
    }
    if (selectedCase.amountAtRiskPaise >= selectedCase.policy.highValueApprovalThresholdPaise) {
      return { action, requiresConfirmation: false, decision: "APPROVAL_REQUIRED" };
    }
    return { action, requiresConfirmation: action === "CREATE_PAYMENT_LINK", decision: "ALLOWED" };
  }
}
