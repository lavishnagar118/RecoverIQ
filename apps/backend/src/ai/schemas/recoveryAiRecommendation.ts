import { z } from "zod";

export const recoveryAiRecommendationSchema = z.object({
  schemaVersion: z.literal("1"),
  diagnosis: z.object({
    primaryCause: z.enum([
      "INSUFFICIENT_FUNDS",
      "BANK_DECLINED",
      "NETWORK_ERROR",
      "AUTHENTICATION_FAILED",
      "LIMIT_EXCEEDED",
      "USER_ABANDONED",
      "PRICE_SHOCK",
      "PAYMENT_METHOD_UNAVAILABLE",
      "CHECKOUT_TIMEOUT",
      "UNKNOWN"
    ]),
    summary: z.string().trim().min(1).max(500),
    keyFactors: z.array(z.string().trim().min(1).max(240)).max(8)
  }),
  recommendedAction: z
    .enum(["RETRY_PAYMENT", "SEND_REMINDER", "CREATE_PAYMENT_LINK", "OFFER_DISCOUNT", "STOP"])
    .nullable(),
  recommendationReason: z.string().trim().min(1).max(500),
  customerMessage: z.string().trim().max(500).nullable(),
  confidence: z.number().min(0).max(1),
  decisionStrength: z.enum(["STRONG", "MODERATE", "WEAK", "STOP", "ABSTAIN"]),
  abstain: z.boolean(),
  toolRequests: z
    .array(
      z.object({
        tool: z.enum([
          "getRecoveryCase",
          "getCustomerHistory",
          "getBaselineDecision",
          "getActionCandidates",
          "getRecoveryPolicy"
        ]),
        arguments: z.record(z.string())
      })
    )
    .max(5),
  warnings: z.array(z.string().trim().min(1).max(240)).max(8),
  limitations: z.array(z.string().trim().min(1).max(240)).max(8)
}).strict();

export type RecoveryAiRecommendation = z.infer<typeof recoveryAiRecommendationSchema>;

export const recoveryAiRecommendationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "diagnosis",
    "recommendedAction",
    "recommendationReason",
    "customerMessage",
    "confidence",
    "decisionStrength",
    "abstain",
    "toolRequests",
    "warnings",
    "limitations"
  ],
  properties: {
    schemaVersion: { const: "1" },
    diagnosis: {
      type: "object",
      additionalProperties: false,
      required: ["primaryCause", "summary", "keyFactors"],
      properties: {
        primaryCause: { type: "string" },
        summary: { type: "string" },
        keyFactors: { type: "array", items: { type: "string" }, maxItems: 8 }
      }
    },
    recommendedAction: {
      type: ["string", "null"],
      enum: ["RETRY_PAYMENT", "SEND_REMINDER", "CREATE_PAYMENT_LINK", "OFFER_DISCOUNT", "STOP", null]
    },
    recommendationReason: { type: "string" },
    customerMessage: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    decisionStrength: { enum: ["STRONG", "MODERATE", "WEAK", "STOP", "ABSTAIN"] },
    abstain: { type: "boolean" },
    toolRequests: { type: "array", maxItems: 5 },
    warnings: { type: "array", maxItems: 8, items: { type: "string" } },
    limitations: { type: "array", maxItems: 8, items: { type: "string" } }
  }
} as const;
