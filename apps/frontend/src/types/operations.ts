export interface Execution {
  executionKey: string;
  caseId: string;
  action: string;
  status: string;
  amountPaise: number;
  attemptNumber: number;
  referenceId: string;
  razorpayPaymentLinkId?: string;
  shortUrl?: string;
  paymentLinkStatus?: string;
  razorpayPaymentId?: string;
  paidAmountPaise?: number;
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OperationsCase {
  caseId: string;
  amountAtRisk: number;
  currency: "INR";
  scenarioType: string;
  status: string;
  selectedAction?: string;
  recoveryProbability: number;
  expectedRecoveryValue: number;
  expectedNetRecovery: number;
  executionState?: string;
  updatedAt: string;
}

export interface RealSummary {
  datasetType: "real_demo";
  totalCases: number;
  amountAtRisk: number;
  expectedRecovery: number;
  recoveredAmount: number;
  recoveryRate: number;
  activeCases: number;
  stoppedCases: number;
  failedCases: number;
  escalatedCases: number;
}

export interface SyntheticSummary {
  datasetType: "synthetic";
  seed: number;
  generatedCaseCount: number;
  totalCases: number;
  totalAmountAtRisk: number;
  totalExpectedRecoveryValue: number;
  numberOfRecoverableCases: number;
  recoveryRate?: number;
  statusDistribution: Record<string, number>;
  scenarioDistribution: Record<string, number>;
}

export interface AuditEvent {
  eventId: string;
  eventType: string;
  caseId?: string;
  executionKey?: string;
  actor: string;
  reason: string;
  policyDecision?: string;
  outcome?: string;
  razorpayPaymentLinkId?: string;
  razorpayPaymentId?: string;
  razorpayEventId?: string;
  error?: { code: string; message: string };
  createdAt: string;
}

export interface Policy {
  maximumAutomaticAttempts: number;
  highValueApprovalThresholdPaise: number;
  maximumDiscountRate: number;
  discountRate: number;
  minimumExpectedNetRecoveryPaise: number;
  allowDiscounts: boolean;
  fixedActionCostsPaise: Record<string, number>;
}

export interface CaseDetail {
  case: OperationsCase & {
    customerId: string;
    failureReason: string;
    customerHistory: {
      successfulPayments: number;
      failedPayments: number;
      chargebacks: number;
      daysSinceLastSuccessfulPayment?: number;
      lifetimeValue: number;
      isRepeatCustomer: boolean;
      optedOut: boolean;
    };
    previousAttempts: number;
    checkoutStatus: string;
    createdAt: string;
    recoveredAmountPaise?: number;
    recoveredPaymentId?: string;
  };
  scoring: { recoveryProbability: number; expectedRecoveryValue: number; reasons: string[] };
  decision?: {
    selectedAction: string;
    decisionStrength: string;
    reasons: string[];
    candidates: Array<{
      action: string;
      appropriate: boolean;
      recoveryProbability: number;
      expectedNetRecovery: number;
      reasons: string[];
    }>;
  };
  executions: Execution[];
  latestExecution?: Execution;
  policy: Policy;
  policyDecision: string;
  approvalRequired: boolean;
  paymentEvidence?: {
    source: "RAZORPAY_TEST_MODE" | "LOCAL_WEBHOOK_SIMULATION";
    paymentLinkId?: string;
    paymentId?: string;
    capturedAmountPaise?: number;
  };
  aiAdvisory?: {
    source: string;
    validationCode: string;
    deterministicAction: string;
    aiAction: string | null;
    latencyMs: number;
    recommendation: {
      diagnosis: { primaryCause: string; summary: string; keyFactors: string[] };
      recommendedAction: string | null;
      recommendationReason: string;
      customerMessage: string | null;
      confidence: number;
      decisionStrength: string;
      abstain: boolean;
      warnings: string[];
      limitations: string[];
    };
  };
  aiState: string;
}

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantResponse {
  available: boolean;
  message: string;
  intent: string;
  recommendation: string | null;
  requiresConfirmation: boolean;
  action: string | null;
  reasoning: string;
  confidence: number;
  policyDecision?: string;
  caseId?: string;
  conversationId: string;
}

export interface AssistantActionResult {
  caseId: string;
  action: string;
  status: string;
  executionKey: string;
  paymentLinkStatus?: string;
  razorpayPaymentLinkId?: string;
  shortUrl?: string;
  message: string;
}
