export const auditEventTypes = [
  "ACTION_SELECTED",
  "POLICY_APPROVED",
  "POLICY_REJECTED",
  "RAZORPAY_REQUESTED",
  "RAZORPAY_RESPONSE_RECEIVED",
  "PAYMENT_LINK_CREATED",
  "WEBHOOK_RECEIVED",
  "WEBHOOK_SIGNATURE_REJECTED",
  "WEBHOOK_DUPLICATE_IGNORED",
  "PAYMENT_RECONCILED",
  "RECOVERY_MARKED_SUCCESSFUL",
  "RECOVERY_MARKED_FAILED"
] as const;

export type AuditEventType = (typeof auditEventTypes)[number];

export interface AuditEvent {
  eventId: string;
  eventType: AuditEventType;
  caseId?: string;
  executionKey?: string;
  actor: "SYSTEM" | "AI" | "MERCHANT";
  reason: string;
  policyDecision?: "APPROVED" | "REJECTED";
  outcome?: "SUCCESS" | "FAILURE" | "IGNORED" | "PENDING";
  razorpayPaymentLinkId?: string;
  razorpayPaymentId?: string;
  razorpayEventId?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
  error?: { code: string; message: string };
  createdAt: string;
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
}
