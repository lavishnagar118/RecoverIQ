import { describe, expect, it } from "vitest";

import { ControlledRecoveryAgent } from "../../ai/agent/controlledRecoveryAgent.js";
import { buildRecoveryAiContext } from "../../ai/context/recoveryAiContext.js";
import { recoveryAiRecommendationSchema } from "../../ai/schemas/recoveryAiRecommendation.js";
import { recoveryReadOnlyTools } from "../../ai/tools/recoveryReadTools.js";
import { isSafeCustomerMessage, validateRecoveryAiOutput } from "../../ai/validation/recoveryAiValidation.js";
import type { AiProvider } from "../../ai/types.js";
import { inrRupeesToPaise, type RecoveryCaseInput } from "../../recovery/domain/recoveryCase.js";
import { defaultRecoveryPolicy } from "../../recovery/domain/recoveryPolicy.js";
import { selectRecoveryAction } from "../../recovery/decision/recoveryActionEngine.js";

const buildCase = (overrides: Partial<RecoveryCaseInput> = {}): RecoveryCaseInput => ({
  caseId: "case_ai_test",
  customerId: "customer_private",
  amountAtRisk: inrRupeesToPaise(10_000),
  currency: "INR",
  scenarioType: "PAYMENT_FAILED",
  failureReason: "NETWORK_ERROR",
  customerHistory: {
    successfulPayments: 6,
    failedPayments: 0,
    chargebacks: 0,
    lifetimeValue: inrRupeesToPaise(80_000),
    isRepeatCustomer: true,
    optedOut: false
  },
  previousAttempts: 0,
  checkoutStatus: "PAYMENT_FAILED",
  status: "AT_RISK",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

const validOutput = {
  schemaVersion: "1" as const,
  diagnosis: {
    primaryCause: "NETWORK_ERROR" as const,
    summary: "A temporary technical interruption is plausible.",
    keyFactors: ["Network error", "No prior recovery attempts"]
  },
  recommendedAction: "RETRY_PAYMENT" as const,
  recommendationReason: "Retry matches the deterministic candidate.",
  customerMessage: "We couldn't complete your payment because of a temporary connection issue.",
  confidence: 0.9,
  decisionStrength: "STRONG" as const,
  abstain: false,
  toolRequests: [],
  warnings: [],
  limitations: []
};

class FakeProvider implements AiProvider {
  constructor(
    private readonly output: unknown,
    private readonly error?: Error
  ) {}

  async generateStructured() {
    if (this.error) {
      throw this.error;
    }
    return { output: this.output, provider: "fake", model: "fake", latencyMs: 1 };
  }
}

describe("controlled recovery AI layer", () => {
  it("accepts a valid structured AI response", async () => {
    const result = await new ControlledRecoveryAgent(new FakeProvider(validOutput), { enabled: true }).advise(
      buildCase()
    );
    expect(result.source).toBe("AI");
    expect(result.validationCode).toBe("VALID");
    expect(result.recommendation.recommendedAction).toBe("RETRY_PAYMENT");
  });

  it("rejects malformed and unknown-field responses", () => {
    const decision = selectRecoveryAction(buildCase());
    const malformed = validateRecoveryAiOutput({ ...validOutput, unexpected: true }, buildCase(), decision);
    expect(malformed.code).toBe("SCHEMA_INVALID");
    expect(recoveryAiRecommendationSchema.safeParse({ ...validOutput, confidence: 2 }).success).toBe(false);
    expect(
      recoveryAiRecommendationSchema.safeParse({
        ...validOutput,
        toolRequests: [{ tool: "executePayment", arguments: {} }]
      }).success
    ).toBe(false);
  });

  it("rejects invalid or ineligible actions", () => {
    const decision = selectRecoveryAction(buildCase());
    const result = validateRecoveryAiOutput(
      { ...validOutput, recommendedAction: "OFFER_DISCOUNT" },
      buildCase(),
      decision
    );
    expect(result.code).toBe("SEMANTIC_INVALID");
  });

  it("marks a valid but conflicting recommendation without changing deterministic authority", () => {
    const abandoned = buildCase({
      scenarioType: "CHECKOUT_ABANDONED",
      checkoutStatus: "ABANDONED_BEFORE_PAYMENT",
      failureReason: "PRICE_SHOCK"
    });
    const decision = selectRecoveryAction(abandoned);
    const output = { ...validOutput, recommendedAction: "SEND_REMINDER" as const };
    const result = validateRecoveryAiOutput(output, abandoned, decision);
    expect(result.code).toBe(
      output.recommendedAction === decision.selectedAction ? "VALID" : "CONFLICT"
    );
    expect(decision.selectedAction).not.toBe(output.recommendedAction);
  });

  it("falls back for terminal and opted-out cases", async () => {
    const terminal = await new ControlledRecoveryAgent(undefined, { enabled: true }).advise(
      buildCase({ status: "EXPIRED" })
    );
    expect(terminal.source).toBe("DETERMINISTIC_FALLBACK");
    expect(terminal.deterministicAction).toBe("STOP");

    const optedOut = await new ControlledRecoveryAgent(undefined, { enabled: true }).advise(
      buildCase({
        status: "CUSTOMER_OPTED_OUT",
        customerHistory: { ...buildCase().customerHistory, optedOut: true }
      })
    );
    expect(optedOut.recommendation.customerMessage).toBeNull();
  });

  it("falls back when the provider times out or errors", async () => {
    const result = await new ControlledRecoveryAgent(
      new FakeProvider(null, new Error("timeout")),
      { enabled: true }
    ).advise(buildCase());
    expect(result.source).toBe("DETERMINISTIC_FALLBACK");
    expect(result.validationCode).toBe("PROVIDER_ERROR");
    expect(result.deterministicAction).toBe("RETRY_PAYMENT");
  });

  it("rejects unsafe messages and supports abstention", () => {
    expect(isSafeCustomerMessage("We couldn't complete your payment because of a temporary connection issue.")).toBe(
      true
    );
    expect(isSafeCustomerMessage("Your payment is guaranteed to succeed.")).toBe(false);
    expect(isSafeCustomerMessage("Please share your OTP to complete payment.")).toBe(false);
    expect(isSafeCustomerMessage("Click here to pay: https://evil.example")).toBe(false);
    expect(isSafeCustomerMessage("Pay now or your account will be suspended.")).toBe(false);
    const decision = selectRecoveryAction(buildCase());
    const unsafe = validateRecoveryAiOutput(
      { ...validOutput, customerMessage: "Pay immediately or your account will be suspended." },
      buildCase(),
      decision
    );
    expect(unsafe.code).toBe("UNSAFE_MESSAGE");

    const abstained = validateRecoveryAiOutput(
      { ...validOutput, abstain: true, confidence: 0.2 },
      buildCase(),
      decision
    );
    expect(abstained.code).toBe("ABSTAINED");
    expect(abstained.recommendation.recommendedAction).toBeNull();
  });

  it("forces customer messages to null for STOP, terminal, and opt-out cases", () => {
    const optedOut = buildCase({
      customerHistory: { ...buildCase().customerHistory, optedOut: true }
    });
    const optedOutResult = validateRecoveryAiOutput(validOutput, optedOut, selectRecoveryAction(optedOut));
    expect(optedOutResult.recommendation.customerMessage).toBeNull();

    const terminal = buildCase({ status: "EXPIRED" });
    const terminalResult = validateRecoveryAiOutput(validOutput, terminal, selectRecoveryAction(terminal));
    expect(terminalResult.recommendation.customerMessage).toBeNull();

    const stopOutput = { ...validOutput, recommendedAction: "STOP" as const };
    const stopResult = validateRecoveryAiOutput(stopOutput, buildCase(), selectRecoveryAction(buildCase()));
    expect(stopResult.recommendation.customerMessage).toBeNull();
  });

  it("does not accept AI monetary authority and excludes secrets/PII from context", () => {
    const context = buildRecoveryAiContext(buildCase(), defaultRecoveryPolicy);
    expect(context.baseline.expectedRecoveryValuePaise).toBeTypeOf("number");
    expect(JSON.stringify(context)).not.toContain("customer_private");
    expect(JSON.stringify(context)).not.toContain("secret");
    expect(JSON.stringify(validOutput)).not.toContain("amountToCharge");
    expect(recoveryReadOnlyTools.every((tool) => tool.readOnly)).toBe(true);
    expect(recoveryReadOnlyTools.map((tool) => tool.name)).not.toContain("executePayment");
    expect(recoveryReadOnlyTools.map((tool) => tool.name)).toEqual([
      "getRecoveryCase",
      "getCustomerHistory",
      "getBaselineDecision",
      "getActionCandidates",
      "getRecoveryPolicy"
    ]);
  });

  it("never exposes malformed or unsafe AI output to an execution path", async () => {
    const result = await new ControlledRecoveryAgent(
      new FakeProvider({
        ...validOutput,
        recommendedAction: "OFFER_DISCOUNT",
        customerMessage: "Pay now or your account will be suspended.",
        amountToChargePaise: 999999
      }),
      { enabled: true }
    ).advise(buildCase());

    expect(result.source).toBe("DETERMINISTIC_FALLBACK");
    expect(result.recommendation.recommendedAction).toBe("RETRY_PAYMENT");
    expect(result.recommendation).not.toHaveProperty("amountToChargePaise");
  });
});
