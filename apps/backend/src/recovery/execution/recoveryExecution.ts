import type { RecoveryAction } from "../actions/recoveryActions.js";

export type RecoveryExecutionStatus = "RESERVED" | "REQUESTING" | "CREATED" | "WAITING_RESULT" | "SUCCEEDED" | "FAILED";

export interface RecoveryExecution {
  executionKey: string;
  caseId: string;
  attemptNumber: number;
  action: RecoveryAction;
  status: RecoveryExecutionStatus;
  amountPaise: number;
  currency: "INR";
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

export interface RecoveryExecutionRepository {
  reserve(execution: RecoveryExecution): Promise<{ execution: RecoveryExecution; created: boolean }>;
  update(executionKey: string, update: Partial<RecoveryExecution>): Promise<RecoveryExecution>;
  updateIfStatus(
    executionKey: string,
    statuses: readonly RecoveryExecutionStatus[],
    update: Partial<RecoveryExecution>
  ): Promise<RecoveryExecution | undefined>;
  findByKey(executionKey: string): Promise<RecoveryExecution | undefined>;
  findByPaymentLinkId(paymentLinkId: string): Promise<RecoveryExecution | undefined>;
  list(filters?: { caseId?: string; limit?: number }): Promise<RecoveryExecution[]>;
}
