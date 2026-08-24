import type { Collection, Db } from "mongodb";
import type { RecoveryExecution, RecoveryExecutionRepository } from "./recoveryExecution.js";

export class MongoRecoveryExecutionRepository implements RecoveryExecutionRepository {
  private readonly collection: Collection<RecoveryExecution>;

  constructor(db: Db) {
    this.collection = db.collection<RecoveryExecution>("recovery_executions");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ executionKey: 1 }, { unique: true });
    await this.collection.createIndex({ razorpayPaymentLinkId: 1 }, { unique: true, sparse: true });
    await this.collection.createIndex({ referenceId: 1 }, { unique: true });
  }

  async reserve(execution: RecoveryExecution): Promise<{ execution: RecoveryExecution; created: boolean }> {
    try {
      const result = await this.collection.findOneAndUpdate(
        { executionKey: execution.executionKey },
        { $setOnInsert: execution },
        { upsert: true, returnDocument: "after" }
      );
      if (!result) throw new Error("Execution reservation returned no document");
      return { execution: result, created: result.createdAt === execution.createdAt };
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await this.findByKey(execution.executionKey);
      if (!existing) throw new Error("Execution reservation raced but could not be recovered");
      return { execution: existing, created: false };
    }
  }

  async update(executionKey: string, update: Partial<RecoveryExecution>): Promise<RecoveryExecution> {
    const result = await this.collection.findOneAndUpdate(
      { executionKey },
      { $set: { ...update, updatedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );
    if (!result) throw new Error(`Execution ${executionKey} was not found`);
    return result;
  }

  async updateIfStatus(
    executionKey: string,
    statuses: readonly RecoveryExecution["status"][],
    update: Partial<RecoveryExecution>
  ): Promise<RecoveryExecution | undefined> {
    const result = await this.collection.findOneAndUpdate(
      { executionKey, status: { $in: statuses } },
      { $set: { ...update, updatedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );
    return result ?? undefined;
  }

  async findByKey(executionKey: string): Promise<RecoveryExecution | undefined> {
    return (await this.collection.findOne({ executionKey })) ?? undefined;
  }

  async findByPaymentLinkId(paymentLinkId: string): Promise<RecoveryExecution | undefined> {
    return (await this.collection.findOne({ razorpayPaymentLinkId: paymentLinkId })) ?? undefined;
  }
}
