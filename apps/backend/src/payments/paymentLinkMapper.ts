import { assertIntegerPaise } from "../recovery/domain/recoveryCase.js";
import type { CreatePaymentLinkRequest, RazorpayPaymentLink } from "./razorpayTypes.js";

export const buildPaymentLinkReferenceId = (
  caseId: string,
  attemptNumber: number,
  action: "CREATE_PAYMENT_LINK"
): string => `${caseId}:${attemptNumber}:${action}`;

export const mapPaymentLinkRequest = (request: CreatePaymentLinkRequest): Record<string, unknown> => {
  assertIntegerPaise(request.amountPaise, "amountPaise");
  if (request.amountPaise <= 0) throw new Error("amountPaise must be positive");
  if (request.currency !== "INR") throw new Error("currency must be INR");
  if (
    !Number.isSafeInteger(request.expireByUnixSeconds) ||
    request.expireByUnixSeconds <= Math.floor(Date.now() / 1000)
  ) {
    throw new Error("expireByUnixSeconds must be a future integer timestamp");
  }

  return {
    amount: request.amountPaise,
    currency: request.currency,
    reference_id: request.referenceId,
    description: request.description,
    expire_by: request.expireByUnixSeconds,
    accept_partial: false,
    reminder_enable: true
  };
};

export const mapPaymentLinkResponse = (value: unknown): RazorpayPaymentLink => {
  if (!value || typeof value !== "object") {
    throw new Error("Razorpay returned an invalid Payment Link response");
  }
  const response = value as Partial<RazorpayPaymentLink> & {
    amount_paid?: number;
    expire_by?: number;
  };
  if (
    typeof response.id !== "string" ||
    typeof response.amount !== "number" ||
    response.currency !== "INR" ||
    typeof response.reference_id !== "string" ||
    typeof response.status !== "string"
  ) {
    throw new Error("Razorpay returned an incomplete Payment Link response");
  }
  return {
    id: response.id,
    amount: response.amount,
    amountPaid: response.amount_paid ?? response.amountPaid,
    currency: response.currency,
    reference_id: response.reference_id,
    short_url: response.short_url,
    status: response.status,
    expire_by: response.expire_by ?? response.expire_by,
    payments: response.payments
  };
};

export const mapPaymentLinkListResponse = (value: unknown): RazorpayPaymentLink[] => {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) {
    throw new Error("Razorpay returned an invalid Payment Link list response");
  }
  return (value as { items: unknown[] }).items.map(mapPaymentLinkResponse);
};
