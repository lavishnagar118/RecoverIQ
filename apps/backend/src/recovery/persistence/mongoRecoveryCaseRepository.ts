import type { Collection, Db } from "mongodb";
import type { PersistedRecoveryCase } from "../domain/recoveryCase.js";
import type { RecoveryCaseRepository } from "./recoveryCaseRepository.js";

export class MongoRecoveryCaseRepository implements RecoveryCaseRepository {
  private readonly collection: Collection<PersistedRecoveryCase>;

  constructor(db: Db) {
    this.collection = db.collection<PersistedRecoveryCase>("recovery_cases");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ caseId: 1 }, { unique: true });
  }

  async getById(caseId: string): Promise<PersistedRecoveryCase | undefined> {
    return (await this.collection.findOne({ caseId })) ?? undefined;
  }

  async save(recoveryCase: PersistedRecoveryCase): Promise<void> {
    await this.collection.insertOne(recoveryCase);
  }

  async update(caseId: string, update: Partial<PersistedRecoveryCase>): Promise<PersistedRecoveryCase> {
    const result = await this.collection.findOneAndUpdate(
      { caseId },
      { $set: { ...update, updatedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );
    if (!result) throw new Error(`Recovery case ${caseId} was not found`);
    return result;
  }

  async transition(
    caseId: string,
    fromStatuses: readonly PersistedRecoveryCase["status"][],
    toStatus: PersistedRecoveryCase["status"],
    update: Partial<PersistedRecoveryCase> = {}
  ): Promise<PersistedRecoveryCase | undefined> {
    const result = await this.collection.findOneAndUpdate(
      { caseId, status: { $in: fromStatuses } },
      { $set: { ...update, status: toStatus, updatedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );
    return result ?? undefined;
  }

  async failAttempt(caseId: string, toStatus: "FAILED" | "STOPPED"): Promise<PersistedRecoveryCase> {
    const result = await this.collection.findOneAndUpdate(
      { caseId, status: { $in: ["ACTION_EXECUTED", "WAITING_RESULT"] } },
      { $set: { status: toStatus, updatedAt: new Date().toISOString() }, $inc: { previousAttempts: 1 } },
      { returnDocument: "after" }
    );
    if (!result) {
      const current = await this.collection.findOne({ caseId });
      if (!current) throw new Error(`Recovery case ${caseId} was not found`);
      return current;
    }
    return result;
  }
}
