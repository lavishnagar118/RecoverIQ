import type { RecoveryExecution, RecoveryExecutionRepository } from "./recoveryExecution.js";

export class InMemoryRecoveryExecutionRepository implements RecoveryExecutionRepository {
  readonly executions = new Map<string, RecoveryExecution>();

  async reserve(execution: RecoveryExecution): Promise<{ execution: RecoveryExecution; created: boolean }> {
    const existing = this.executions.get(execution.executionKey);
    if (existing) return { execution: existing, created: false };
    this.executions.set(execution.executionKey, execution);
    return { execution, created: true };
  }

  async update(executionKey: string, update: Partial<RecoveryExecution>): Promise<RecoveryExecution> {
    const current = this.executions.get(executionKey);
    if (!current) throw new Error(`Execution ${executionKey} was not found`);
    const next = { ...current, ...update, updatedAt: new Date().toISOString() };
    this.executions.set(executionKey, next);
    return next;
  }

  async updateIfStatus(
    executionKey: string,
    statuses: readonly RecoveryExecution["status"][],
    update: Partial<RecoveryExecution>
  ): Promise<RecoveryExecution | undefined> {
    const current = this.executions.get(executionKey);
    if (!current || !statuses.includes(current.status)) return undefined;
    return this.update(executionKey, update);
  }

  async findByKey(executionKey: string): Promise<RecoveryExecution | undefined> {
    return this.executions.get(executionKey);
  }

  async findByPaymentLinkId(paymentLinkId: string): Promise<RecoveryExecution | undefined> {
    return [...this.executions.values()].find((execution) => execution.razorpayPaymentLinkId === paymentLinkId);
  }
}
