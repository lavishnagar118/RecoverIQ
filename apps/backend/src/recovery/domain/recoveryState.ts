import { type RecoveryStatus, recoveryStatuses } from "./recoveryCase.js";

export const terminalRecoveryStatuses = [
  "RECOVERED",
  "STOPPED",
  "EXPIRED",
  "CANCELLED",
  "CUSTOMER_OPTED_OUT"
] as const satisfies readonly RecoveryStatus[];

export const recoveryStatusTransitions: Record<RecoveryStatus, readonly RecoveryStatus[]> = {
  AT_RISK: ["ANALYZING", "EXPIRED", "CANCELLED", "CUSTOMER_OPTED_OUT"],
  ANALYZING: ["ACTION_SELECTED", "STOPPED", "EXPIRED", "CANCELLED", "CUSTOMER_OPTED_OUT"],
  ACTION_SELECTED: ["AWAITING_APPROVAL", "ACTION_EXECUTED", "STOPPED", "CANCELLED"],
  AWAITING_APPROVAL: ["ACTION_EXECUTED", "EXPIRED", "CANCELLED"],
  ACTION_EXECUTED: ["WAITING_RESULT", "FAILED", "RECOVERED"],
  WAITING_RESULT: ["RECOVERED", "FAILED", "EXPIRED", "CUSTOMER_OPTED_OUT"],
  FAILED: ["ACTION_SELECTED", "STOPPED"],
  RECOVERED: [],
  STOPPED: [],
  EXPIRED: [],
  CANCELLED: [],
  CUSTOMER_OPTED_OUT: []
};

export const isRecoveryStatus = (value: string): value is RecoveryStatus =>
  recoveryStatuses.includes(value as RecoveryStatus);

export const isTerminalRecoveryStatus = (status: RecoveryStatus): boolean =>
  (terminalRecoveryStatuses as readonly RecoveryStatus[]).includes(status);

export const canTransitionRecoveryStatus = (
  fromStatus: RecoveryStatus,
  toStatus: RecoveryStatus
): boolean => recoveryStatusTransitions[fromStatus].includes(toStatus);
