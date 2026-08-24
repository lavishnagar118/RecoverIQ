import type { Collection, Db } from "mongodb";

export interface RazorpayWebhookEvent {
  razorpayEventId: string;
  eventType: string;
  paymentLinkId?: string;
  rawBodyHash: string;
  processingStatus: "RECEIVED" | "PROCESSED" | "DUPLICATE" | "FAILED";
  processingError?: string;
  receivedAt: string;
  processedAt?: string;
}

export interface WebhookRepository {
  claim(event: RazorpayWebhookEvent): Promise<{ event: RazorpayWebhookEvent; claimed: boolean }>;
  markProcessed(eventId: string, update: Partial<RazorpayWebhookEvent>): Promise<void>;
}

export class MongoWebhookRepository implements WebhookRepository {
  private readonly collection: Collection<RazorpayWebhookEvent>;

  constructor(db: Db) {
    this.collection = db.collection<RazorpayWebhookEvent>("razorpay_webhook_events");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ razorpayEventId: 1 }, { unique: true });
  }

  async claim(event: RazorpayWebhookEvent): Promise<{ event: RazorpayWebhookEvent; claimed: boolean }> {
    try {
      await this.collection.insertOne(event);
      return { event, claimed: true };
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await this.collection.findOne({ razorpayEventId: event.razorpayEventId });
      if (!existing) throw new Error("Webhook duplicate race could not be recovered");
      if (existing.processingStatus === "FAILED") {
        const retry = await this.collection.findOneAndUpdate(
          { razorpayEventId: event.razorpayEventId, processingStatus: "FAILED" },
          { $set: { processingStatus: "RECEIVED", processingError: undefined } },
          { returnDocument: "after" }
        );
        return { event: retry ?? existing, claimed: Boolean(retry) };
      }
      return { event: existing, claimed: false };
    }
  }

  async markProcessed(eventId: string, update: Partial<RazorpayWebhookEvent>): Promise<void> {
    await this.collection.updateOne({ razorpayEventId: eventId }, { $set: update });
  }
}

export class InMemoryWebhookRepository implements WebhookRepository {
  readonly events = new Map<string, RazorpayWebhookEvent>();

  async claim(event: RazorpayWebhookEvent): Promise<{ event: RazorpayWebhookEvent; claimed: boolean }> {
    const existing = this.events.get(event.razorpayEventId);
    if (existing) {
      if (existing.processingStatus === "FAILED") {
        const retry = { ...event, processingStatus: "RECEIVED" as const };
        this.events.set(event.razorpayEventId, retry);
        return { event: retry, claimed: true };
      }
      return { event: existing, claimed: false };
    }
    this.events.set(event.razorpayEventId, event);
    return { event, claimed: true };
  }

  async markProcessed(eventId: string, update: Partial<RazorpayWebhookEvent>): Promise<void> {
    const current = this.events.get(eventId);
    if (current) this.events.set(eventId, { ...current, ...update });
  }
}
