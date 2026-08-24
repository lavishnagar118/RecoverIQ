import { describe, expect, it } from "vitest";
import { InMemoryAuditRepository } from "../../audit/auditRepository.js";
import { InMemoryRecoveryCaseRepository } from "../../recovery/persistence/recoveryCaseRepository.js";
import { InMemoryRecoveryExecutionRepository } from "../../recovery/execution/inMemoryRecoveryExecutionRepository.js";
import { RecoveryExecutionService } from "../../recovery/execution/recoveryExecutionService.js";
import type { RazorpayPaymentLink, RazorpayProvider } from "../../payments/razorpayTypes.js";

const recoveryCase = {
  caseId: "demo-case",
  customerId: "customer-1",
  amountAtRisk: 10_000,
  currency: "INR" as const,
  scenarioType: "PAYMENT_FAILED" as const,
  failureReason: "BANK_DECLINED" as const,
  customerHistory: {
    successfulPayments: 1, failedPayments: 1, chargebacks: 0, lifetimeValue: 20_000, isRepeatCustomer: true, optedOut: false
  },
  previousAttempts: 0,
  checkoutStatus: "PAYMENT_FAILED" as const,
  status: "ACTION_SELECTED" as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const link = (status = "created"): RazorpayPaymentLink => ({
  id: "plink_1", amount: 10_000, amountPaid: status === "paid" ? 10_000 : 0, currency: "INR",
  reference_id: "demo-case:1:CREATE_PAYMENT_LINK", status, short_url: "https://rzp.io/demo",
  payments: status === "paid" ? [{ id: "pay_1", amount: 10_000, status: "captured" }] : []
});

class FakeProvider implements RazorpayProvider {
  createCalls = 0;
  shouldFail = false;
  async createPaymentLink(): Promise<RazorpayPaymentLink> {
    this.createCalls += 1;
    if (this.shouldFail) throw new Error("simulated timeout");
    return link();
  }
  async fetchPaymentLink(): Promise<RazorpayPaymentLink> { return link(); }
  async findPaymentLinksByReferenceId(): Promise<RazorpayPaymentLink[]> { return this.shouldFail ? [link()] : []; }
}

class FailOnceCaseRepository extends InMemoryRecoveryCaseRepository {
  private shouldFail = true;
  override async transition(...args: Parameters<InMemoryRecoveryCaseRepository["transition"]>) {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("simulated Mongo case write failure");
    }
    return super.transition(...args);
  }
}

const makeService = (provider = new FakeProvider()) => {
  const cases = new InMemoryRecoveryCaseRepository(new Map([[recoveryCase.caseId, recoveryCase]]));
  const executions = new InMemoryRecoveryExecutionRepository();
  const audit = new InMemoryAuditRepository();
  return { service: new RecoveryExecutionService(cases, executions, provider, audit), cases, executions, audit, provider };
};

describe("RecoveryExecutionService", () => {
  it("prevents duplicate execution and recovers a lost create response", async () => {
    const first = makeService();
    const [firstExecution, secondExecution] = await Promise.all([
      first.service.createPaymentLink(recoveryCase.caseId),
      first.service.createPaymentLink(recoveryCase.caseId)
    ]);
    expect(first.provider.createCalls).toBe(1);
    expect(secondExecution.executionKey).toBe(firstExecution.executionKey);

    const lost = makeService();
    lost.provider.shouldFail = true;
    const recovered = await lost.service.createPaymentLink(recoveryCase.caseId);
    expect(recovered.razorpayPaymentLinkId).toBe("plink_1");
    expect(lost.provider.createCalls).toBe(1);
  });

  it("reconciles paid, partial, and cancelled outcomes", async () => {
    const paid = makeService();
    await paid.service.createPaymentLink(recoveryCase.caseId);
    await paid.service.reconcilePaymentLink({ ...link("paid"), reference_id: "demo-case:1:CREATE_PAYMENT_LINK" });
    expect((await paid.cases.getById(recoveryCase.caseId))?.status).toBe("RECOVERED");

    const partial = makeService();
    await partial.service.createPaymentLink(recoveryCase.caseId);
    await partial.service.reconcilePaymentLink({ ...link("partially_paid"), amountPaid: 5_000 });
    expect((await partial.cases.getById(recoveryCase.caseId))?.status).toBe("WAITING_RESULT");

    const cancelled = makeService();
    await cancelled.service.createPaymentLink(recoveryCase.caseId);
    await cancelled.service.reconcilePaymentLink(link("cancelled"));
    expect((await cancelled.cases.getById(recoveryCase.caseId))?.status).toBe("FAILED");
  });

  it("rejects mismatched payment evidence", async () => {
    const result = makeService();
    await result.service.createPaymentLink(recoveryCase.caseId);
    await expect(result.service.reconcilePaymentLink({ ...link("paid"), amount: 1 })).rejects.toThrow("amount mismatch");
    await expect(result.service.reconcilePaymentLink({ ...link("paid"), reference_id: "other" })).rejects.toThrow("reference mismatch");
    await expect(result.service.reconcilePaymentLink({ ...link("paid"), currency: "USD" as "INR" })).rejects.toThrow("currency mismatch");
  });

  it("advances the attempt identity after a failed Payment Link", async () => {
    const result = makeService();
    await result.service.createPaymentLink(recoveryCase.caseId);
    await result.service.reconcilePaymentLink(link("expired"));
    expect((await result.cases.getById(recoveryCase.caseId))?.previousAttempts).toBe(1);
    const next = await result.service.createPaymentLink(recoveryCase.caseId);
    expect(next.executionKey).toBe("demo-case:2:CREATE_PAYMENT_LINK");
  });

  it("requires durable storage when configured for external execution", async () => {
    const result = makeService();
    const durableRequired = new RecoveryExecutionService(
      result.cases,
      result.executions,
      result.provider,
      result.audit,
      { requireDurableStorage: true }
    );
    await expect(durableRequired.createPaymentLink(recoveryCase.caseId)).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
      statusCode: 503
    });
  });

  it("repairs case state after a persistence failure without creating another link", async () => {
    const cases = new FailOnceCaseRepository(new Map([[recoveryCase.caseId, recoveryCase]]));
    const executions = new InMemoryRecoveryExecutionRepository();
    const audit = new InMemoryAuditRepository();
    const provider = new FakeProvider();
    const service = new RecoveryExecutionService(cases, executions, provider, audit);
    await expect(service.createPaymentLink(recoveryCase.caseId)).rejects.toThrow("case write failure");
    const repaired = await service.createPaymentLink(recoveryCase.caseId);
    expect(repaired.razorpayPaymentLinkId).toBe("plink_1");
    expect(provider.createCalls).toBe(1);
    expect((await cases.getById(recoveryCase.caseId))?.status).toBe("WAITING_RESULT");
  });

  it("never regresses recovered state under concurrent terminal events", async () => {
    for (const terminalStatus of ["cancelled", "expired"] as const) {
      const result = makeService();
      await result.service.createPaymentLink(recoveryCase.caseId);
      await Promise.all([
        result.service.reconcilePaymentLink(link("paid")),
        result.service.reconcilePaymentLink(link(terminalStatus))
      ]);
      expect((await result.cases.getById(recoveryCase.caseId))?.status).toBe("RECOVERED");
    }

    const failed = makeService();
    await failed.service.createPaymentLink(recoveryCase.caseId);
    await Promise.all([
      failed.service.reconcilePaymentLink(link("cancelled")),
      failed.service.reconcilePaymentLink(link("expired"))
    ]);
    expect((await failed.cases.getById(recoveryCase.caseId))?.status).toBe("FAILED");
  });
});
