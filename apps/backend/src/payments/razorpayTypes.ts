export interface CreatePaymentLinkRequest {
  amountPaise: number;
  currency: "INR";
  referenceId: string;
  description: string;
  expireByUnixSeconds: number;
}

export interface RazorpayPaymentLink {
  id: string;
  amount: number;
  amountPaid?: number;
  currency: "INR";
  reference_id: string;
  short_url?: string;
  status: string;
  expire_by?: number;
  payments?: Array<{ id?: string; amount?: number; status?: string }>;
}

export interface RazorpayProvider {
  createPaymentLink(request: CreatePaymentLinkRequest): Promise<RazorpayPaymentLink>;
  fetchPaymentLink(paymentLinkId: string): Promise<RazorpayPaymentLink>;
  findPaymentLinksByReferenceId(referenceId: string): Promise<RazorpayPaymentLink[]>;
}
