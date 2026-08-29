import { ControlledRecoveryAgent, createConfiguredAiProvider, type RecoveryAdvisoryResult } from "../../ai/index.js";
import type { AuditEvent, AuditRepository } from "../../audit/auditEvent.js";
import { defaultRecoveryPolicy } from "../domain/recoveryPolicy.js";
import {
  calculateTotalAmountAtRisk,
  type PersistedRecoveryCase,
  type RecoveryScenarioType,
  type RecoveryStatus,
  recoveryStatuses,
  recoveryScenarioTypes
} from "../domain/recoveryCase.js";
import { isTerminalRecoveryStatus } from "../domain/recoveryState.js";
import type { RecoveryExecution, RecoveryExecutionRepository } from "../execution/recoveryExecution.js";
import { selectRecoveryAction, type RecoveryActionDecision } from "../decision/recoveryActionEngine.js";
import type { RecoveryCaseRepository } from "../persistence/recoveryCaseRepository.js";
import {
  defaultSyntheticRecoverySeed,
  generateSyntheticRecoveryCases
} from "../synthetic/syntheticRecoveryCases.js";
import { evaluateRecoveryBatch } from "./recoveryEvaluationService.js";
import { scoreRecoveryCase } from "../scoring/baselineScoring.js";

const persistedCaseLimit = 10_000;

export interface RecoveryCaseListItem {
  caseId: string;
  amountAtRisk: number;
  currency: "INR";
  scenarioType: RecoveryScenarioType;
  status: RecoveryStatus;
  selectedAction?: string;
  recoveryProbability: number;
  expectedRecoveryValue: number;
  expectedNetRecovery: number;
  executionState?: RecoveryExecution["status"];
  updatedAt: string;
}

export interface RecoveryOperationsSummary {
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

const isActiveStatus = (status: RecoveryStatus): boolean =>
  !isTerminalRecoveryStatus(status) && status !== "FAILED";

const getDecision = (recoveryCase: PersistedRecoveryCase): RecoveryActionDecision | undefined => {
  try {
    return selectRecoveryAction(recoveryCase, defaultRecoveryPolicy);
  } catch {
    return undefined;
  }
};

const getScoredCase = (recoveryCase: PersistedRecoveryCase) => scoreRecoveryCase(recoveryCase);

const getExpectedRecovery = (recoveryCase: PersistedRecoveryCase): number =>
  recoveryCase.expectedRecoveryValue ?? getScoredCase(recoveryCase).expectedRecoveryValue;

const getRecoveryProbability = (recoveryCase: PersistedRecoveryCase): number =>
  recoveryCase.recoveryProbability ?? getScoredCase(recoveryCase).recoveryProbability;

const getExpectedNetRecovery = (decision: RecoveryActionDecision | undefined): number =>
  decision?.selectedCandidate.expectedNetRecovery ?? 0;

const latestExecution = (executions: RecoveryExecution[]): RecoveryExecution | undefined =>
  [...executions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

export class RecoveryOperationsService {
  constructor(
    private readonly cases: RecoveryCaseRepository,
    private readonly executions: RecoveryExecutionRepository,
    private readonly audit: AuditRepository,
    private readonly aiAgent = new ControlledRecoveryAgent(createConfiguredAiProvider()),
    private readonly dataSource: "mongo" | "synthetic" = "mongo"
  ) {}

  async getDashboard(): Promise<{
    realDemo: RecoveryOperationsSummary;
    syntheticEvaluation: ReturnType<typeof evaluateRecoveryBatch> & { seed: number; generatedCaseCount: number };
  }> {
    const persistedCases = this.dataSource === "mongo"
      ? await this.cases.list({ limit: persistedCaseLimit })
      : [];
    const realDemo = this.buildRealSummary(persistedCases);
    const syntheticCases = generateSyntheticRecoveryCases(1_000, defaultSyntheticRecoverySeed);
    return {
      realDemo,
      syntheticEvaluation: {
        ...evaluateRecoveryBatch(syntheticCases),
        seed: defaultSyntheticRecoverySeed,
        generatedCaseCount: syntheticCases.length
      }
    };
  }

  async listCases(filters: {
    status?: RecoveryStatus;
    scenarioType?: RecoveryScenarioType;
    limit?: number;
  } = {}): Promise<RecoveryCaseListItem[]> {
    const persistedCases = this.dataSource === "mongo"
      ? await this.cases.list({ ...filters, limit: filters.limit ?? 100 })
      : [];
    return Promise.all(persistedCases.map((recoveryCase) => this.toCaseListItem(recoveryCase)));
  }

  async getCaseDetail(caseId: string): Promise<{
    case: PersistedRecoveryCase;
    scoring: ReturnType<typeof scoreRecoveryCase>;
    decision?: RecoveryActionDecision;
    executions: RecoveryExecution[];
    latestExecution?: RecoveryExecution;
    policy: typeof defaultRecoveryPolicy;
    policyDecision: "APPROVED" | "REJECTED" | "NOT_EVALUATED";
    approvalRequired: boolean;
    paymentEvidence?: {
      source: "RAZORPAY_TEST_MODE" | "LOCAL_WEBHOOK_SIMULATION";
      paymentLinkId?: string;
      paymentId?: string;
      capturedAmountPaise?: number;
    };
    aiAdvisory?: RecoveryAdvisoryResult;
    aiState: "AVAILABLE" | "NOT_EVALUATED";
  } | undefined> {
    const recoveryCase = await this.cases.getById(caseId);
    if (!recoveryCase) return undefined;
    const executions = await this.executions.list({ caseId, limit: 100 });
    const currentExecution = latestExecution(executions);
    const decision = getDecision(recoveryCase);
    const approvalRequired = recoveryCase.amountAtRisk >= defaultRecoveryPolicy.highValueApprovalThresholdPaise;
    const policyDecision =
      recoveryCase.status === "ACTION_SELECTED" || recoveryCase.status === "ACTION_EXECUTED" ||
      recoveryCase.status === "WAITING_RESULT" || recoveryCase.status === "RECOVERED"
        ? "APPROVED"
        : "NOT_EVALUATED";
    const paymentLinkId = currentExecution?.razorpayPaymentLinkId;
    const paymentId = currentExecution?.razorpayPaymentId ?? recoveryCase.recoveredPaymentId;
    const paymentEvidence = paymentLinkId || paymentId
      ? {
          source: paymentId?.startsWith("pay_local_")
            ? ("LOCAL_WEBHOOK_SIMULATION" as const)
            : ("RAZORPAY_TEST_MODE" as const),
          paymentLinkId,
          ...(paymentId && !paymentId.startsWith("pay_local_") ? { paymentId } : {}),
          capturedAmountPaise: currentExecution?.paidAmountPaise ?? recoveryCase.recoveredAmountPaise
        }
      : undefined;
    const aiEligible = Boolean(decision);
    const aiAdvisory = aiEligible ? await this.aiAgent.advise(recoveryCase) : undefined;

    return {
      case: recoveryCase,
      scoring: {
        ...getScoredCase(recoveryCase),
        recoveryProbability: getRecoveryProbability(recoveryCase),
        expectedRecoveryValue: getExpectedRecovery(recoveryCase),
        reasons: recoveryCase.scoringReasons ?? getScoredCase(recoveryCase).reasons
      },
      decision,
      executions,
      latestExecution: currentExecution,
      policy: defaultRecoveryPolicy,
      policyDecision,
      approvalRequired,
      paymentEvidence,
      aiAdvisory,
      aiState: aiEligible ? "AVAILABLE" : "NOT_EVALUATED"
    };
  }

  async listAuditEvents(caseId?: string, limit = 200): Promise<AuditEvent[]> {
    return this.audit.list({ caseId, limit });
  }

  getPolicy(): typeof defaultRecoveryPolicy {
    return {
      ...defaultRecoveryPolicy,
      fixedActionCostsPaise: { ...defaultRecoveryPolicy.fixedActionCostsPaise }
    };
  }

  async getAnalytics(): Promise<{
    realDemo: RecoveryOperationsSummary;
    syntheticEvaluation: ReturnType<typeof evaluateRecoveryBatch> & { seed: number; generatedCaseCount: number };
  }> {
    return this.getDashboard();
  }

  private async toCaseListItem(recoveryCase: PersistedRecoveryCase): Promise<RecoveryCaseListItem> {
    const decision = getDecision(recoveryCase);
    const executions = await this.executions.list({ caseId: recoveryCase.caseId, limit: 1 });
    return {
      caseId: recoveryCase.caseId,
      amountAtRisk: recoveryCase.amountAtRisk,
      currency: recoveryCase.currency,
      scenarioType: recoveryCase.scenarioType,
      status: recoveryCase.status,
      selectedAction: recoveryCase.selectedAction ?? decision?.selectedAction,
      recoveryProbability: getRecoveryProbability(recoveryCase),
      expectedRecoveryValue: getExpectedRecovery(recoveryCase),
      expectedNetRecovery: getExpectedNetRecovery(decision),
      executionState: executions[0]?.status,
      updatedAt: recoveryCase.updatedAt
    };
  }

  private buildRealSummary(cases: PersistedRecoveryCase[]): RecoveryOperationsSummary {
    const amountAtRisk = calculateTotalAmountAtRisk(cases);
    const expectedRecovery = cases.reduce((total, recoveryCase) => total + getExpectedRecovery(recoveryCase), 0);
    const recoveredAmount = cases.reduce((total, recoveryCase) => total + (recoveryCase.recoveredAmountPaise ?? 0), 0);
    const recoveredCases = cases.filter((recoveryCase) => recoveryCase.status === "RECOVERED").length;
    return {
      datasetType: "real_demo",
      totalCases: cases.length,
      amountAtRisk,
      expectedRecovery,
      recoveredAmount,
      recoveryRate: cases.length === 0 ? 0 : recoveredCases / cases.length,
      activeCases: cases.filter((recoveryCase) => isActiveStatus(recoveryCase.status)).length,
      stoppedCases: cases.filter((recoveryCase) => recoveryCase.status === "STOPPED").length,
      failedCases: cases.filter((recoveryCase) => recoveryCase.status === "FAILED").length,
      escalatedCases: cases.filter((recoveryCase) => recoveryCase.status === "AWAITING_APPROVAL").length
    };
  }
}

export { recoveryScenarioTypes, recoveryStatuses };
