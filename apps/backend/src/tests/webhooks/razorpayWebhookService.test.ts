import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryAuditRepository } from "../../audit/auditRepository.js";
import { InMemoryRecoveryCaseRepository } from "../../recovery/persistence/recoveryCaseRepository.js";
import { InMemoryRecoveryExecutionRepository } from "../../recovery/execution/inMemoryRecoveryExecutionRepository.js";
import { RecoveryExecutionService } from "../../recovery/execution/recoveryExecutionService.js";
import { InMemoryWebhookRepository } from "../../webhooks/webhookRepository.js";
import { RazorpayWebhookService } from "../../webhooks/razorpayWebhookService.js";
import type { RazorpayPaymentLink, RazorpayProvider } from "../../payments/razorpayTypes.js";
import type { AuditEvent, AuditRepository } from "../../audit/auditEvent.js";

const demoCase = {
  caseId: "webhook-case", customerId: "customer", amountAtRisk: 1000, currency: "INR" as const,
  scenarioType: "PAYMENT_FAILED" as const, failureReason: "BANK_DECLINED" as const,
  customerHistory: { successfulPayments: 1, failedPayments: 1, chargebacks: 0, lifetimeValue: 1000, isRepeatCustomer: true, optedOut: false },
  previousAttempts: 0, checkoutStatus: "PAYMENT_FAILED" as const, status: "ACTION_SELECTED" as const,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
};

class Provider implements RazorpayProvider {
  async createPaymentLink(): Promise<RazorpayPaymentLink> {
    return { id: "plink_webhook", amount: 1000, amountPaid: 0, currency: "INR", reference_id: "webhook-case:1:CREATE_PAYMENT_LINK", status: "created" };
  }
  async fetchPaymentLink(): Promise<RazorpayPaymentLink> { throw new Error("not used"); }
  async findPaymentLinksByReferenceId(): Promise<RazorpayPaymentLink[]> { return []; }
}

class FailOnceAudit implements AuditRepository {
  private failed = false;
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> {
    if (!this.failed && event.eventType === "WEBHOOK_RECEIVED") {
      this.failed = true;
      throw new Error("simulated audit failure");
    }
    this.events.push(event);
  }
}

const makePayload = (event: string, status: string, amountPaid = 1000) => Buffer.from(JSON.stringify({
  event,
  payload: {
    payment_link: {
      entity: {
        id: "plink_webhook",
        amount: 1000,
        amount_paid: amountPaid,
        currency: "INR",
        reference_id: "webhook-case:1:CREATE_PAYMENT_LINK",
        status,
        payments: [{ id: "pay_webhook", amount: amountPaid, status: amountPaid === 1000 ? "captured" : "created" }]
      }
    }
  }
}));

describe("Razorpay webhook service", () => {
  it("processes paid events once and ignores duplicates", async () => {
    const cases = new InMemoryRecoveryCaseRepository(new Map([[demoCase.caseId, demoCase]]));
    const executions = new InMemoryRecoveryExecutionRepository();
    const audit = new InMemoryAuditRepository();
    const service = new RecoveryExecutionService(cases, executions, new Provider(), audit);
    await service.createPaymentLink(demoCase.caseId);
    const webhooks = new InMemoryWebhookRepository();
    const handler = new RazorpayWebhookService(service, webhooks, audit, "secret");
    const body = makePayload("payment_link.paid", "paid");
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    await expect(Promise.all([
      handler.handle(body, signature, "event-1"),
      handler.handle(body, signature, "event-1")
    ])).resolves.toEqual(expect.arrayContaining(["processed", "duplicate"]));
    const cancelled = makePayload("payment_link.cancelled", "cancelled", 1000);
    const cancelledSignature = createHmac("sha256", "secret").update(cancelled).digest("hex");
    await expect(handler.handle(cancelled, cancelledSignature, "event-late-cancel")).resolves.toBe("processed");
    expect((await cases.getById(demoCase.caseId))?.status).toBe("RECOVERED");
    expect(audit.events.some((event) => event.eventType === "WEBHOOK_DUPLICATE_IGNORED")).toBe(true);
  });

  it("keeps partial payments waiting and rejects unknown links", async () => {
    const cases = new InMemoryRecoveryCaseRepository(new Map([[demoCase.caseId, demoCase]]));
    const executions = new InMemoryRecoveryExecutionRepository();
    const audit = new InMemoryAuditRepository();
    const service = new RecoveryExecutionService(cases, executions, new Provider(), audit);
    await service.createPaymentLink(demoCase.caseId);
    const handler = new RazorpayWebhookService(service, new InMemoryWebhookRepository(), audit, "secret");
    const partial = makePayload("payment_link.partially_paid", "partially_paid", 500);
    const signature = createHmac("sha256", "secret").update(partial).digest("hex");
    await handler.handle(partial, signature, "event-partial");
    expect((await cases.getById(demoCase.caseId))?.status).toBe("WAITING_RESULT");
    const unknown = Buffer.from(JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: "unknown", amount: 1000, currency: "INR", reference_id: "unknown", status: "paid" } } } }));
    const unknownSignature = createHmac("sha256", "secret").update(unknown).digest("hex");
    await expect(handler.handle(unknown, unknownSignature, "event-unknown")).rejects.toThrow("Unknown Razorpay Payment Link");
    await expect(handler.handle(partial, "bad", "event-invalid")).rejects.toThrow("Invalid Razorpay webhook signature");
    await expect(handler.handle(partial, undefined, "event-missing")).rejects.toThrow("Invalid Razorpay webhook signature");
  });

  it("marks expired links failed and records audit events", async () => {
    const cases = new InMemoryRecoveryCaseRepository(new Map([[demoCase.caseId, demoCase]]));
    const executions = new InMemoryRecoveryExecutionRepository();
    const audit = new InMemoryAuditRepository();
    const service = new RecoveryExecutionService(cases, executions, new Provider(), audit);
    await service.createPaymentLink(demoCase.caseId);
    const handler = new RazorpayWebhookService(service, new InMemoryWebhookRepository(), audit, "secret");
    const expired = makePayload("payment_link.expired", "expired", 0);
    const signature = createHmac("sha256", "secret").update(expired).digest("hex");
    await handler.handle(expired, signature, "event-expired");
    expect((await cases.getById(demoCase.caseId))?.status).toBe("FAILED");
    expect(audit.events.some((event) => event.eventType === "RECOVERY_MARKED_FAILED")).toBe(true);
  });

  it("allows a failed processing claim to retry successfully", async () => {
    const cases = new InMemoryRecoveryCaseRepository(new Map([[demoCase.caseId, demoCase]]));
    const executions = new InMemoryRecoveryExecutionRepository();
    const audit = new FailOnceAudit();
    const service = new RecoveryExecutionService(cases, executions, new Provider(), audit);
    await service.createPaymentLink(demoCase.caseId);
    const handler = new RazorpayWebhookService(service, new InMemoryWebhookRepository(), audit, "secret");
    const body = makePayload("payment_link.paid", "paid");
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    await expect(handler.handle(body, signature, "retry-event")).rejects.toThrow("simulated audit failure");
    await expect(handler.handle(body, signature, "retry-event")).resolves.toBe("processed");
    expect((await cases.getById(demoCase.caseId))?.status).toBe("RECOVERED");
  });
});
