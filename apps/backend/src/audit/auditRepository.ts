import type { Collection, Db } from "mongodb";
import type { AuditEvent, AuditRepository } from "./auditEvent.js";

export class MongoAuditRepository implements AuditRepository {
  private readonly collection: Collection<AuditEvent>;

  constructor(db: Db) {
    this.collection = db.collection<AuditEvent>("audit_events");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ eventId: 1 }, { unique: true });
    await this.collection.createIndex({ caseId: 1, createdAt: -1 });
  }

  async append(event: AuditEvent): Promise<void> {
    await this.collection.insertOne(event);
  }

  async list(filters: { caseId?: string; limit?: number } = {}): Promise<AuditEvent[]> {
    return this.collection
      .find(filters.caseId ? { caseId: filters.caseId } : {})
      .sort({ createdAt: -1 })
      .limit(filters.limit ?? 200)
      .toArray();
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async list(filters: { caseId?: string; limit?: number } = {}): Promise<AuditEvent[]> {
    const events = this.events
      .filter((event) => !filters.caseId || event.caseId === filters.caseId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return filters.limit ? events.slice(0, filters.limit) : events;
  }
}
