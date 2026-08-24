import { randomUUID } from "node:crypto";
import type { AuditRepository } from "../../audit/auditEvent.js";
import { defaultRecoveryPolicy } from "../domain/recoveryPolicy.js";
import type { PersistedRecoveryCase } from "../domain/recoveryCase.js";
import { canTransitionRecoveryStatus } from "../domain/recoveryState.js";
import type { RazorpayPaymentLink, RazorpayProvider } from "../../payments/razorpayTypes.js";
import { buildPaymentLinkReferenceId } from "../../payments/paymentLinkMapper.js";
import type { RecoveryCaseRepository } from "../persistence/recoveryCaseRepository.js";
import type { RecoveryExecution, RecoveryExecutionRepository } from "./recoveryExecution.js";
import { validatePaymentLinkExecution } from "./recoveryPolicyGate.js";
import { RazorpayProviderError } from "../../payments/razorpayErrors.js";

const maximumExpirySeconds = 7 * 24 * 60 * 60;

export class RecoveryExecutionService {
  constructor(
    private readonly cases: RecoveryCaseRepository,
    private readonly executions: RecoveryExecutionRepository,
    private readonly provider: RazorpayProvider,
    private readonly audit: AuditRepository,
    private readonly options: { requireDurableStorage?: boolean } = {}
  ) {}

  async createPaymentLink(caseId: string): Promise<RecoveryExecution> {
    if (this.options.requireDurableStorage) {
      throw new RazorpayProviderError("CONFIGURATION_ERROR", "Durable MongoDB storage is required for Razorpay execution");
    }
    let recoveryCase = await this.cases.getById(caseId);
    if (!recoveryCase) throw new Error(`Recovery case ${caseId} was not found`);

    const attemptNumber = recoveryCase.previousAttempts + 1;
    const executionKey = buildPaymentLinkReferenceId(caseId, attemptNumber, "CREATE_PAYMENT_LINK");
    const existingExecution = await this.executions.findByKey(executionKey);
    if (existingExecution && ["CREATED", "WAITING_RESULT", "SUCCEEDED"].includes(existingExecution.status)) {
      if (existingExecution.status !== "SUCCEEDED") await this.ensureCaseWaiting(recoveryCase);
      return existingExecution;
    }
    if (existingExecution?.status === "REQUESTING") {
      const recoveredLink = await this.recoverLostCreation(executionKey);
      if (recoveredLink) return this.persistCreatedLink(recoveryCase, existingExecution, recoveredLink);
      return existingExecution;
    }
    const requiresApproval = recoveryCase.amountAtRisk >= defaultRecoveryPolicy.highValueApprovalThresholdPaise;
    try {
      validatePaymentLinkExecution(recoveryCase, defaultRecoveryPolicy, attemptNumber, requiresApproval, false);
    } catch (error) {
      await this.writeAudit("POLICY_REJECTED", recoveryCase, undefined, error instanceof Error ? error.message : "Policy rejected", "REJECTED");
      throw error;
    }
    if (recoveryCase.status === "FAILED") {
      await this.cases.transition(caseId, ["FAILED"], "ACTION_SELECTED", { selectedAction: "CREATE_PAYMENT_LINK" });
      recoveryCase = { ...recoveryCase, status: "ACTION_SELECTED", selectedAction: "CREATE_PAYMENT_LINK" };
    }

    const referenceId = executionKey;
    const now = new Date().toISOString();
    const execution: RecoveryExecution = {
      executionKey: referenceId,
      caseId,
      attemptNumber,
      action: "CREATE_PAYMENT_LINK",
      status: "RESERVED",
      amountPaise: recoveryCase.amountAtRisk,
      currency: "INR",
      referenceId,
      createdAt: now,
      updatedAt: now
    };
    const reservation = await this.executions.reserve(execution);
    if (!reservation.created) {
      return reservation.execution;
    }

    await this.writeAudit("POLICY_APPROVED", recoveryCase, reservation.execution, "Deterministic execution policy approved", "APPROVED");
    await this.executions.update(referenceId, { status: "REQUESTING" });
    await this.writeAudit("RAZORPAY_REQUESTED", recoveryCase, reservation.execution, "Creating Razorpay Test Mode Payment Link", undefined, "PENDING");

    let link: RazorpayPaymentLink | undefined;
    try {
      link = await this.provider.createPaymentLink({
        amountPaise: recoveryCase.amountAtRisk,
        currency: "INR",
        referenceId,
        description: `RecoverIQ payment recovery for case ${caseId}`,
        expireByUnixSeconds: Math.floor(Date.now() / 1000) + maximumExpirySeconds
      });
    } catch (error) {
      const recovered = await this.recoverLostCreation(referenceId);
      if (recovered) link = recovered;
      else {
        const message = error instanceof Error ? error.message : "Razorpay Payment Link creation failed";
        await this.executions.update(referenceId, { status: "FAILED", failureCode: "RAZORPAY_CREATE_FAILED", failureMessage: message });
        await this.cases.failAttempt(caseId, "FAILED");
        await this.writeAudit("RECOVERY_MARKED_FAILED", recoveryCase, reservation.execution, message, undefined, "FAILURE");
        throw error;
      }
    }

    return this.persistCreatedLink(recoveryCase, reservation.execution, link);
  }

  private async persistCreatedLink(
    recoveryCase: PersistedRecoveryCase,
    reservation: RecoveryExecution,
    link: RazorpayPaymentLink
  ): Promise<RecoveryExecution> {
    const updated = await this.executions.update(reservation.executionKey, {
      status: "WAITING_RESULT",
      razorpayPaymentLinkId: link.id,
      shortUrl: link.short_url,
      paymentLinkStatus: link.status
    });
    await this.ensureCaseWaiting(recoveryCase);
    await this.writeAudit("RAZORPAY_RESPONSE_RECEIVED", recoveryCase, updated, "Razorpay response received", undefined, "SUCCESS");
    await this.writeAudit("PAYMENT_LINK_CREATED", recoveryCase, updated, "Payment Link created in Razorpay Test Mode", undefined, "SUCCESS");
    return updated;
  }

  private async ensureCaseWaiting(recoveryCase: PersistedRecoveryCase): Promise<void> {
    if (recoveryCase.status === "WAITING_RESULT") return;
    const executed = await this.cases.transition(
      recoveryCase.caseId,
      ["ACTION_SELECTED", "ACTION_EXECUTED"],
      "ACTION_EXECUTED",
      { selectedAction: "CREATE_PAYMENT_LINK" }
    );
    if (!executed) throw new Error("Payment Link exists but recovery case state could not be advanced");
    const waiting = await this.cases.transition(recoveryCase.caseId, ["ACTION_EXECUTED"], "WAITING_RESULT");
    if (!waiting) throw new Error("Payment Link exists but recovery case could not enter WAITING_RESULT");
  }

  async reconcilePaymentLink(link: RazorpayPaymentLink, eventId?: string): Promise<RecoveryExecution> {
    const execution = await this.executions.findByPaymentLinkId(link.id);
    if (!execution) throw new Error(`Unknown Razorpay Payment Link ${link.id}`);
    const recoveryCase = await this.cases.getById(execution.caseId);
    if (!recoveryCase) throw new Error(`Recovery case ${execution.caseId} was not found`);
    if (link.reference_id !== execution.referenceId) throw new Error("Payment Link reference mismatch");
    if (link.amount !== execution.amountPaise) throw new Error("Payment Link amount mismatch");
    if (link.currency !== execution.currency) throw new Error("Payment Link currency mismatch");
    if (recoveryCase.status === "RECOVERED" && execution.status === "SUCCEEDED") {
      return execution;
    }

    const paidAmount = link.amountPaid ?? link.payments?.reduce((total, payment) => total + (payment.amount ?? 0), 0) ?? 0;
    const paymentId = link.payments?.find((payment) => payment.status === "captured" || payment.status === "paid")?.id;
    if (link.status === "paid") {
      if (paidAmount < execution.amountPaise) throw new Error("Paid Payment Link has insufficient trusted paid amount");
      const updated = await this.executions.updateIfStatus(execution.executionKey, ["RESERVED", "REQUESTING", "CREATED", "WAITING_RESULT", "FAILED"], {
        status: "SUCCEEDED",
        paymentLinkStatus: link.status,
        paidAmountPaise: paidAmount,
        razorpayPaymentId: paymentId
      });
      const effectiveExecution = updated ?? await this.executions.findByKey(execution.executionKey);
      if (!effectiveExecution) throw new Error(`Execution ${execution.executionKey} was not found after reconciliation`);
      const transitioned = await this.cases.transition(
        recoveryCase.caseId,
        ["ACTION_EXECUTED", "WAITING_RESULT", "FAILED", "STOPPED"],
        "RECOVERED",
        { recoveredAmountPaise: paidAmount, recoveredPaymentId: paymentId }
      );
      if (transitioned || recoveryCase.status === "RECOVERED") {
        await this.writeAudit("PAYMENT_RECONCILED", recoveryCase, effectiveExecution, "Trusted Razorpay payment reconciled", undefined, "SUCCESS", eventId);
        await this.writeAudit("RECOVERY_MARKED_SUCCESSFUL", recoveryCase, effectiveExecution, "Full Payment Link payment recovered", undefined, "SUCCESS", eventId);
      }
      return effectiveExecution;
    }

    const isPartial = link.status === "partially_paid";
    const updated = await this.executions.updateIfStatus(execution.executionKey, ["RESERVED", "REQUESTING", "CREATED", "WAITING_RESULT"], {
      status: isPartial ? "WAITING_RESULT" : "FAILED",
      paymentLinkStatus: link.status,
      paidAmountPaise: paidAmount,
      razorpayPaymentId: paymentId
    });
    const effectiveExecution = updated ?? await this.executions.findByKey(execution.executionKey);
    if (!effectiveExecution) throw new Error(`Execution ${execution.executionKey} was not found after reconciliation`);
    if (effectiveExecution.status === "SUCCEEDED") return effectiveExecution;
    if (isPartial) {
      await this.writeAudit("PAYMENT_RECONCILED", recoveryCase, effectiveExecution, "Partial trusted Razorpay payment recorded; full payment remains required", undefined, "PENDING", eventId);
    } else {
      const nextStatus = canTransitionRecoveryStatus(recoveryCase.status, "FAILED") ? "FAILED" : "STOPPED";
      await this.cases.failAttempt(recoveryCase.caseId, nextStatus);
      await this.writeAudit("RECOVERY_MARKED_FAILED", recoveryCase, effectiveExecution, `Payment Link ${link.status}`, undefined, "FAILURE", eventId);
    }
    return effectiveExecution;
  }

  private async recoverLostCreation(referenceId: string): Promise<RazorpayPaymentLink | undefined> {
    const links = await this.provider.findPaymentLinksByReferenceId(referenceId);
    return links.find((link) => link.reference_id === referenceId);
  }

  private async writeAudit(
    eventType: Parameters<AuditRepository["append"]>[0]["eventType"],
    recoveryCase: PersistedRecoveryCase,
    execution: RecoveryExecution | undefined,
    reason: string,
    policyDecision?: "APPROVED" | "REJECTED",
    outcome?: "SUCCESS" | "FAILURE" | "IGNORED" | "PENDING",
    razorpayEventId?: string
  ): Promise<void> {
    await this.audit.append({
      eventId: randomUUID(),
      eventType,
      caseId: recoveryCase.caseId,
      executionKey: execution?.executionKey,
      actor: "SYSTEM",
      reason,
      policyDecision,
      outcome,
      razorpayPaymentLinkId: execution?.razorpayPaymentLinkId,
      razorpayPaymentId: execution?.razorpayPaymentId,
      razorpayEventId,
      createdAt: new Date().toISOString()
    });
  }
}
