import { createHash, randomUUID } from "node:crypto";
import type { AuditRepository } from "../audit/auditEvent.js";
import { env } from "../config/env.js";
import type { RecoveryExecutionService } from "../recovery/execution/recoveryExecutionService.js";
import { parseRazorpayWebhook, verifyRazorpaySignature } from "./razorpayWebhook.js";
import type { WebhookRepository } from "./webhookRepository.js";

const supportedEvents = new Set(["payment_link.paid", "payment_link.partially_paid", "payment_link.cancelled", "payment_link.expired"]);

export class RazorpayWebhookService {
  constructor(
    private readonly executions: RecoveryExecutionService,
    private readonly webhooks: WebhookRepository,
    private readonly audit: AuditRepository,
    private readonly webhookSecret = env.razorpay.webhookSecret
  ) {}

  async handle(rawBody: Buffer, signature: string | undefined, eventId: string | undefined): Promise<"processed" | "duplicate"> {
    if (!this.webhookSecret || !verifyRazorpaySignature(rawBody, signature, this.webhookSecret)) {
      await this.audit.append({
        eventId: randomUUID(),
        eventType: "WEBHOOK_SIGNATURE_REJECTED",
        actor: "SYSTEM",
        reason: "Razorpay webhook signature was missing or invalid",
        outcome: "FAILURE",
        createdAt: new Date().toISOString()
      });
      throw this.badRequest("Invalid Razorpay webhook signature");
    }
    if (!eventId) throw this.badRequest("Missing x-razorpay-event-id");
    let parsed;
    try {
      parsed = parseRazorpayWebhook(rawBody);
    } catch {
      throw this.badRequest("Malformed Razorpay webhook payload");
    }
    const claim = await this.webhooks.claim({
      razorpayEventId: eventId,
      eventType: parsed.event,
      paymentLinkId: parsed.paymentLink.id,
      rawBodyHash: createHash("sha256").update(rawBody).digest("hex"),
      processingStatus: "RECEIVED",
      receivedAt: new Date().toISOString()
    });
    if (!claim.claimed) {
      await this.audit.append({
        eventId: randomUUID(),
        eventType: "WEBHOOK_DUPLICATE_IGNORED",
        actor: "SYSTEM",
        razorpayEventId: eventId,
        reason: "Razorpay event was already claimed",
        outcome: "IGNORED",
        createdAt: new Date().toISOString()
      });
      return "duplicate";
    }
    try {
      await this.audit.append({
        eventId: randomUUID(),
        eventType: "WEBHOOK_RECEIVED",
        actor: "SYSTEM",
        razorpayEventId: eventId,
        razorpayPaymentLinkId: parsed.paymentLink.id,
        reason: `Received Razorpay event ${parsed.event}`,
        outcome: "PENDING",
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      await this.webhooks.markProcessed(eventId, {
        processingStatus: "FAILED",
        processingError: error instanceof Error ? error.message : "Webhook audit failed"
      });
      throw error;
    }
    if (!supportedEvents.has(parsed.event)) {
      await this.webhooks.markProcessed(eventId, { processingStatus: "PROCESSED", processedAt: new Date().toISOString() });
      return "processed";
    }
    try {
      await this.executions.reconcilePaymentLink(
        { ...parsed.paymentLink, status: parsed.event.replace("payment_link.", "") },
        eventId
      );
      await this.webhooks.markProcessed(eventId, { processingStatus: "PROCESSED", processedAt: new Date().toISOString() });
      return "processed";
    } catch (error) {
      await this.webhooks.markProcessed(eventId, { processingStatus: "FAILED", processingError: error instanceof Error ? error.message : "Webhook processing failed" });
      throw error;
    }
  }

  private badRequest(message: string): Error & { statusCode: number; expose: boolean } {
    return Object.assign(new Error(message), { statusCode: 400, expose: true });
  }
}
