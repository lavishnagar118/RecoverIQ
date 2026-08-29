import { describe, expect, it, vi } from "vitest";

import { InMemoryAuditRepository } from "../../audit/auditRepository.js";
import {
  ConversationalAssistant,
  type RecoveryActionExecutor
} from "../../ai/conversation/conversationalAssistant.js";
import type { AiProvider, AiProviderRequest } from "../../ai/types.js";
import { defaultRecoveryPolicy } from "../../recovery/domain/recoveryPolicy.js";
import type { PersistedRecoveryCase } from "../../recovery/domain/recoveryCase.js";
import type { RecoveryExecution } from "../../recovery/execution/recoveryExecution.js";
import { InMemoryRecoveryExecutionRepository } from "../../recovery/execution/inMemoryRecoveryExecutionRepository.js";
import { InMemoryRecoveryCaseRepository } from "../../recovery/persistence/recoveryCaseRepository.js";

const makeCase = (overrides: Partial<PersistedRecoveryCase> = {}): PersistedRecoveryCase => ({
  caseId: "case_conversation_test",
  customerId: "customer_private",
  amountAtRisk: 100_000,
  currency: "INR",
  scenarioType: "CHECKOUT_ABANDONED",
  failureReason: "USER_ABANDONED",
  customerHistory: {
    successfulPayments: 5,
    failedPayments: 1,
    chargebacks: 0,
    lifetimeValue: 500_000,
    isRepeatCustomer: true,
    optedOut: false
  },
  previousAttempts: 0,
  checkoutStatus: "ABANDONED_BEFORE_PAYMENT",
  status: "AT_RISK",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

const output = (overrides: Record<string, unknown> = {}) => ({
  message: "I checked the case and the deterministic recommendation is to create a Payment Link.",
  intent: "ANALYZE_CASE",
  recommendation: "CREATE_PAYMENT_LINK",
  requiresConfirmation: true,
  action: "CREATE_PAYMENT_LINK",
  reasoning: "The checkout was abandoned and no recovery is recorded.",
  confidence: 0.9,
  ...overrides
});

class FakeProvider implements AiProvider {
  readonly requests: AiProviderRequest[] = [];

  constructor(private readonly response: unknown, private readonly failure?: Error) {}

  async generateStructured(request: AiProviderRequest) {
    this.requests.push(request);
    if (this.failure) throw this.failure;
    return { output: this.response, provider: "fake", model: "fake", latencyMs: 1 };
  }
}

const makeExecution = (): RecoveryExecution => ({
  executionKey: "case_conversation_test:1:CREATE_PAYMENT_LINK",
  caseId: "case_conversation_test",
  action: "CREATE_PAYMENT_LINK",
  status: "WAITING_RESULT",
  amountPaise: 100_000,
  currency: "INR",
  attemptNumber: 1,
  referenceId: "case_conversation_test:1:CREATE_PAYMENT_LINK",
  paymentLinkStatus: "created",
  razorpayPaymentLinkId: "plink_test",
  shortUrl: "https://example.invalid/link",
  createdAt: "2026-01-01T00:02:00.000Z",
  updatedAt: "2026-01-01T00:02:00.000Z"
});

const buildAssistant = async (
  provider: AiProvider | undefined,
  recoveryCase = makeCase(),
  executor: RecoveryActionExecutor = { createPaymentLink: vi.fn().mockResolvedValue(makeExecution()) }
) => {
  const cases = new InMemoryRecoveryCaseRepository();
  await cases.save(recoveryCase);
  const executions = new InMemoryRecoveryExecutionRepository();
  const audit = new InMemoryAuditRepository();
  await audit.append({
    eventId: "audit-1",
    eventType: "POLICY_APPROVED",
    caseId: recoveryCase.caseId,
    actor: "SYSTEM",
    reason: "Deterministic policy approved the candidate.",
    policyDecision: "APPROVED",
    outcome: "SUCCESS",
    createdAt: "2026-01-01T00:01:00.000Z"
  });
  return {
    assistant: new ConversationalAssistant(cases, executions, audit, executor, provider),
    cases,
    executions,
    audit,
    executor
  };
};

describe("conversational recovery assistant", () => {
  it("retrieves case context and answers a natural-language question from actual data", async () => {
    const provider = new FakeProvider(output());
    const { assistant } = await buildAssistant(provider);
    const response = await assistant.respond({
      caseId: "case_conversation_test",
      messages: [{ role: "user", content: "Why hasn't this payment been recovered?" }]
    });

    expect(response).toMatchObject({
      available: true,
      message: expect.stringContaining("deterministic"),
      action: "CREATE_PAYMENT_LINK",
      requiresConfirmation: true,
      policyDecision: "ALLOWED"
    });
    const serializedContext = JSON.stringify(provider.requests[0].context);
    expect(serializedContext).toContain("ABANDONED_BEFORE_PAYMENT");
    expect(serializedContext).toContain("POLICY_APPROVED");
    expect(serializedContext).not.toContain("customer_private");
    expect(serializedContext).not.toContain("secret");
    expect(serializedContext).not.toContain("Authorization");
  });

  it("sends Ollama a strict schema for enum fields, nullable values, and confidence bounds", async () => {
    const provider = new FakeProvider(output());
    const { assistant } = await buildAssistant(provider);
    await assistant.respond({
      caseId: "case_conversation_test",
      messages: [{ role: "user", content: "Analyze this case." }]
    });

    const schema = provider.requests[0].outputSchema as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, {
        enum?: string[];
        anyOf?: Array<{ type: string; enum?: string[] }>;
        minimum?: number;
        maximum?: number;
      }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      "message",
      "intent",
      "recommendation",
      "requiresConfirmation",
      "action",
      "reasoning",
      "confidence"
    ]);
    expect(schema.properties.intent.enum).toEqual([
      "ANALYZE_CASE",
      "EXPLAIN_POLICY",
      "RECOVER_CASE",
      "GENERAL_SUMMARY",
      "FOLLOW_UP",
      "UNKNOWN"
    ]);
    expect(schema.properties.recommendation.anyOf).toEqual([
      { type: "string", enum: ["RETRY_PAYMENT", "SEND_REMINDER", "CREATE_PAYMENT_LINK", "OFFER_DISCOUNT", "STOP"] },
      { type: "null" }
    ]);
    expect(schema.properties.action.anyOf).toEqual(schema.properties.recommendation.anyOf);
    expect(schema.properties.confidence).toMatchObject({ minimum: 0, maximum: 1 });
  });

  it("includes authoritative case facts and prohibits invented facts", async () => {
    const provider = new FakeProvider(output());
    const { assistant } = await buildAssistant(provider);
    await assistant.respond({
      caseId: "case_conversation_test",
      messages: [{ role: "user", content: "Analyze this case." }]
    });

    const requestContext = provider.requests[0].context as {
      recoveriq: { selectedCase: { authoritativeFacts: Record<string, unknown> } };
    };
    expect(requestContext.recoveriq.selectedCase.authoritativeFacts).toMatchObject({
      caseStatus: "AT_RISK",
      executionStatus: null,
      paymentLinkStatus: null,
      amountAtRiskPaise: 100_000,
      paidAmountPaise: null,
      previousAttempts: 0,
      maximumAutomaticAttempts: defaultRecoveryPolicy.maximumAutomaticAttempts,
      deterministicSelectedAction: "CREATE_PAYMENT_LINK",
      policyDecision: "NOT_EVALUATED",
      approvalRequired: false
    });
    expect(provider.requests[0].systemPrompt).toContain("Never invent payment status");
    expect(provider.requests[0].systemPrompt).toContain("Never say that a limit was reached");
    expect(provider.requests[0].systemPrompt).toContain("deterministic policy decision supplied by the backend is authoritative");
  });

  it("rejects contradictory model prose instead of treating it as a case fact", async () => {
    const provider = new FakeProvider(output({
      message: "Automatic attempts are exhausted and the payment was not successfully recovered.",
      reasoning: "The maximum attempts were reached and approval is required.",
      recommendation: "STOP",
      action: "STOP",
      confidence: 0.95
    }));
    const { assistant } = await buildAssistant(provider);
    const response = await assistant.respond({
      caseId: "case_conversation_test",
      messages: [{ role: "user", content: "How many attempts have been made?" }]
    });

    expect(response).toMatchObject({
      action: null,
      recommendation: null,
      confidence: 0,
      reasoning: "The model response contradicted authoritative case facts, so its recommendation was rejected."
    });
    expect(response.message).toContain("0 of 3 automatic attempts");
  });

  it("does not invent an outcome for an unsupported counterfactual", async () => {
    const provider = new FakeProvider(output({
      message: "If the payment had not been recovered, STOP would still be required.",
      reasoning: "The policy would approve that action.",
      recommendation: "STOP",
      action: "STOP"
    }));
    const { assistant } = await buildAssistant(provider);
    const response = await assistant.respond({
      caseId: "case_conversation_test",
      messages: [{ role: "user", content: "What if the payment had not been recovered?" }]
    });

    expect(response).toMatchObject({
      recommendation: null,
      action: null,
      confidence: 0,
      reasoning: "No counterfactual policy or execution outcome was supplied by the backend."
    });
    expect(response.message).toContain("That is hypothetical");
  });

  it("preserves follow-up conversation context", async () => {
    const provider = new FakeProvider(output({ intent: "FOLLOW_UP", message: "This method refers to the Payment Link." }));
    const { assistant } = await buildAssistant(provider);
    await assistant.respond({
      caseId: "case_conversation_test",
      messages: [
        { role: "user", content: "Recover this payment." },
        { role: "assistant", content: "I recommend a Payment Link." },
        { role: "user", content: "Why this method?" }
      ]
    });

    expect(JSON.stringify(provider.requests[0].context)).toContain("Why this method?");
    expect(JSON.stringify(provider.requests[0].context)).toContain("I recommend a Payment Link.");
  });

  it("blocks an AI action that conflicts with the deterministic decision", async () => {
    const provider = new FakeProvider(output({ recommendation: "OFFER_DISCOUNT", action: "OFFER_DISCOUNT" }));
    const { assistant } = await buildAssistant(provider);
    const response = await assistant.respond({
      caseId: "case_conversation_test",
      messages: [{ role: "user", content: "Give the customer a discount." }]
    });

    expect(response).toMatchObject({ action: null, requiresConfirmation: false, policyDecision: "BLOCKED" });
  });

  it("requires confirmation before an allowed financial action", async () => {
    const executor = { createPaymentLink: vi.fn().mockResolvedValue(makeExecution()) };
    const provider = new FakeProvider(output({ intent: "RECOVER_CASE" }));
    const { assistant } = await buildAssistant(provider, makeCase(), executor);
    const response = await assistant.respond({
      caseId: "case_conversation_test",
      messages: [{ role: "user", content: "Recover this payment." }]
    });

    expect(response.requiresConfirmation).toBe(true);
    expect(executor.createPaymentLink).not.toHaveBeenCalled();
  });

  it("executes only a confirmed approved action and reports the actual pending result", async () => {
    const executor = { createPaymentLink: vi.fn().mockResolvedValue(makeExecution()) };
    const { assistant } = await buildAssistant(undefined, makeCase(), executor);
    const result = await assistant.confirmAction("case_conversation_test", "CREATE_PAYMENT_LINK");

    expect(executor.createPaymentLink).toHaveBeenCalledWith("case_conversation_test");
    expect(result).toMatchObject({
      status: "WAITING_RESULT",
      paymentLinkStatus: "created",
      message: expect.stringContaining("webhook reconciliation")
    });
  });

  it("answers factual questions without requiring a recommendation or action", async () => {
    const provider = new FakeProvider(output({ intent: "invalid-intent" }));
    const { assistant } = await buildAssistant(provider, makeCase({ previousAttempts: 1 }));

    const response = await assistant.respond({
      caseId: "case_conversation_test",
      messages: [{ role: "user", content: "How many recovery attempts have been made?" }]
    });

    expect(response).toMatchObject({
      recommendation: null,
      action: null,
      policyDecision: "NOT_EVALUATED"
    });
    expect(response.message).toContain("1 of 3 automatic attempts");
    expect(response.message).not.toContain("exhausted");
  });

  it("answers policy questions from authoritative facts without executing an action", async () => {
    const provider = new FakeProvider(output({ intent: "invalid-intent" }));
    const { assistant } = await buildAssistant(provider, makeCase({ status: "RECOVERED" }));

    const response = await assistant.respond({
      caseId: "case_conversation_test",
      messages: [{ role: "user", content: "Why should we stop recovery?" }]
    });

    expect(response).toMatchObject({
      recommendation: null,
      action: null,
      policyDecision: "NOT_EVALUATED"
    });
    expect(response.message).toContain("deterministic policy selected STOP");
    expect(response.message).toContain("RECOVERED");
  });

  it("rejects high-value actions and surfaces execution failures", async () => {
    const highValue = makeCase({ amountAtRisk: defaultRecoveryPolicy.highValueApprovalThresholdPaise });
    const highValueAssistant = await buildAssistant(undefined, highValue);
    await expect(highValueAssistant.assistant.confirmAction(highValue.caseId, "CREATE_PAYMENT_LINK")).rejects.toThrow(
      "Merchant approval is required"
    );

    const failedExecutor = { createPaymentLink: vi.fn().mockRejectedValue(new Error("provider failed")) };
    const { assistant } = await buildAssistant(undefined, makeCase(), failedExecutor);
    await expect(assistant.confirmAction("case_conversation_test", "CREATE_PAYMENT_LINK")).rejects.toThrow(
      "provider failed"
    );
  });

  it("fails clearly when no AI provider is configured", async () => {
    const { assistant } = await buildAssistant(undefined);
    await expect(
      assistant.respond({
        caseId: "case_conversation_test",
        messages: [{ role: "user", content: "Analyze this case" }]
      })
    ).resolves.toMatchObject({
      available: false,
      intent: "UNAVAILABLE",
      message: expect.stringContaining("unavailable")
    });
  });
});
