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
}

export class InMemoryAuditRepository implements AuditRepository {
  readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}
