import { describe, expect, it } from "vitest";

import { InMemoryAuditRepository } from "../../audit/auditRepository.js";
import { InMemoryRecoveryExecutionRepository } from "../../recovery/execution/inMemoryRecoveryExecutionRepository.js";
import { InMemoryRecoveryCaseRepository } from "../../recovery/persistence/recoveryCaseRepository.js";
import { RecoveryOperationsService } from "../../recovery/services/recoveryOperationsService.js";
import type { PersistedRecoveryCase } from "../../recovery/domain/recoveryCase.js";

const makeCase = (overrides: Partial<PersistedRecoveryCase> = {}): PersistedRecoveryCase => ({
  caseId: "case_operations_test",
  customerId: "customer_private",
  amountAtRisk: 100_000,
  currency: "INR",
  scenarioType: "PAYMENT_FAILED",
  failureReason: "NETWORK_ERROR",
  customerHistory: {
    successfulPayments: 5,
    failedPayments: 1,
    chargebacks: 0,
    lifetimeValue: 500_000,
    isRepeatCustomer: true,
    optedOut: false
  },
  previousAttempts: 0,
  checkoutStatus: "PAYMENT_FAILED",
  status: "AT_RISK",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  recoveryProbability: 0.7,
  expectedRecoveryValue: 70_000,
  scoringReasons: ["Network error is recoverable."],
  ...overrides
});

const buildService = async (recoveryCase = makeCase()) => {
  const cases = new InMemoryRecoveryCaseRepository();
  await cases.save(recoveryCase);
  const executions = new InMemoryRecoveryExecutionRepository();
  const audit = new InMemoryAuditRepository();
  await audit.append({
    eventId: "event_1",
    eventType: "POLICY_APPROVED",
    caseId: recoveryCase.caseId,
    actor: "SYSTEM",
    reason: "Approved by policy",
    policyDecision: "APPROVED",
    outcome: "SUCCESS",
    createdAt: "2026-01-01T00:01:00.000Z"
  });
  return { service: new RecoveryOperationsService(cases, executions, audit), executions, audit };
};

describe("recovery operations observability service", () => {
  it("aggregates dashboard metrics separately from synthetic evaluation", async () => {
    const { service } = await buildService(makeCase({ status: "RECOVERED", recoveredAmountPaise: 100_000 }));
    const dashboard = await service.getDashboard();
    expect(dashboard.realDemo).toMatchObject({
      totalCases: 1,
      amountAtRisk: 100_000,
      expectedRecovery: 70_000,
      recoveredAmount: 100_000,
      recoveryRate: 1
    });
    expect(dashboard.syntheticEvaluation).toMatchObject({ datasetType: "synthetic", totalCases: 1_000 });
  });

  it("lists filtered cases and exposes detail without secrets", async () => {
    const { service } = await buildService();
    const cases = await service.listCases({ status: "AT_RISK" });
    expect(cases[0]).toMatchObject({
      caseId: "case_operations_test",
      selectedAction: "RETRY_PAYMENT",
      expectedNetRecovery: expect.any(Number)
    });
    const detail = await service.getCaseDetail("case_operations_test");
    expect(detail?.case.customerId).toBe("customer_private");
    expect(detail?.decision?.candidates.length).toBe(5);
    expect(JSON.stringify(detail)).not.toContain("Authorization");
  });

  it("returns audit queries and a read-only policy", async () => {
    const { service } = await buildService();
    expect((await service.listAuditEvents("case_operations_test")).length).toBe(1);
    expect(service.getPolicy().maximumAutomaticAttempts).toBe(3);
  });

  it("reports graceful failed and escalated counts", async () => {
    const cases = new InMemoryRecoveryCaseRepository();
    await cases.save(makeCase({ caseId: "failed", status: "FAILED" }));
    await cases.save(makeCase({ caseId: "approval", status: "AWAITING_APPROVAL" }));
    const service = new RecoveryOperationsService(
      cases,
      new InMemoryRecoveryExecutionRepository(),
      new InMemoryAuditRepository()
    );
    const analytics = await service.getAnalytics();
    expect(analytics.realDemo).toMatchObject({ failedCases: 1, escalatedCases: 1, activeCases: 1 });
  });
});
