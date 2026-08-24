import { env } from "../../config/env.js";
import { connectMongo } from "../../config/mongo.js";
import { MongoAuditRepository, InMemoryAuditRepository } from "../../audit/auditRepository.js";
import { MongoRecoveryCaseRepository } from "../persistence/mongoRecoveryCaseRepository.js";
import { InMemoryRecoveryCaseRepository } from "../persistence/recoveryCaseRepository.js";
import { MongoRecoveryExecutionRepository } from "./mongoRecoveryExecutionRepository.js";
import { InMemoryRecoveryExecutionRepository } from "./inMemoryRecoveryExecutionRepository.js";
import { MongoWebhookRepository, InMemoryWebhookRepository } from "../../webhooks/webhookRepository.js";
import { RazorpayHttpProvider } from "../../payments/razorpayHttpProvider.js";
import { RecoveryExecutionService } from "./recoveryExecutionService.js";
import { RazorpayWebhookService } from "../../webhooks/razorpayWebhookService.js";
import { generateSyntheticRecoveryCases } from "../synthetic/syntheticRecoveryCases.js";
import type { RecoveryCaseRepository } from "../persistence/recoveryCaseRepository.js";
import type { RecoveryExecutionRepository } from "./recoveryExecution.js";
import type { AuditRepository } from "../../audit/auditEvent.js";

export interface RecoveryRuntime {
  cases: RecoveryCaseRepository;
  executions: RecoveryExecutionRepository;
  audit: AuditRepository;
  webhook: RazorpayWebhookService;
  execution: RecoveryExecutionService;
}

let runtimePromise: Promise<RecoveryRuntime> | undefined;

const createRuntime = async (): Promise<RecoveryRuntime> => {
  if (env.mongoDbUri) {
    const db = await connectMongo();
    const cases = new MongoRecoveryCaseRepository(db);
    const executions = new MongoRecoveryExecutionRepository(db);
    const audit = new MongoAuditRepository(db);
    const webhooks = new MongoWebhookRepository(db);
    await Promise.all([cases.ensureIndexes(), executions.ensureIndexes(), audit.ensureIndexes(), webhooks.ensureIndexes()]);
    const execution = new RecoveryExecutionService(cases, executions, new RazorpayHttpProvider(), audit);
    return { cases, executions, audit, execution, webhook: new RazorpayWebhookService(execution, webhooks, audit) };
  }

  const cases = new InMemoryRecoveryCaseRepository();
  for (const recoveryCase of generateSyntheticRecoveryCases(25, 2025)) await cases.save(recoveryCase);
  const executions = new InMemoryRecoveryExecutionRepository();
  const audit = new InMemoryAuditRepository();
  const webhooks = new InMemoryWebhookRepository();
  const execution = new RecoveryExecutionService(cases, executions, new RazorpayHttpProvider(), audit, { requireDurableStorage: true });
  return { cases, executions, audit, execution, webhook: new RazorpayWebhookService(execution, webhooks, audit) };
};

export const getRecoveryRuntime = (): Promise<RecoveryRuntime> => {
  runtimePromise ??= createRuntime();
  return runtimePromise;
};

export const resetRecoveryRuntimeForTests = (): void => {
  runtimePromise = undefined;
};
