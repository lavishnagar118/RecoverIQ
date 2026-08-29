import type { PersistedRecoveryCase } from "../domain/recoveryCase.js";

export interface RecoveryCaseRepository {
  getById(caseId: string): Promise<PersistedRecoveryCase | undefined>;
  list(filters?: {
    status?: PersistedRecoveryCase["status"];
    scenarioType?: PersistedRecoveryCase["scenarioType"];
    limit?: number;
  }): Promise<PersistedRecoveryCase[]>;
  save(recoveryCase: PersistedRecoveryCase): Promise<void>;
  update(caseId: string, update: Partial<PersistedRecoveryCase>): Promise<PersistedRecoveryCase>;
  transition(
    caseId: string,
    fromStatuses: readonly PersistedRecoveryCase["status"][],
    toStatus: PersistedRecoveryCase["status"],
    update?: Partial<PersistedRecoveryCase>
  ): Promise<PersistedRecoveryCase | undefined>;
  failAttempt(caseId: string, toStatus: "FAILED" | "STOPPED"): Promise<PersistedRecoveryCase>;
}

export class InMemoryRecoveryCaseRepository implements RecoveryCaseRepository {
  constructor(private readonly cases = new Map<string, PersistedRecoveryCase>()) {}

  async getById(caseId: string): Promise<PersistedRecoveryCase | undefined> {
    return this.cases.get(caseId);
  }

  async list(filters: {
    status?: PersistedRecoveryCase["status"];
    scenarioType?: PersistedRecoveryCase["scenarioType"];
    limit?: number;
  } = {}): Promise<PersistedRecoveryCase[]> {
    const cases = [...this.cases.values()]
      .filter((recoveryCase) => !filters.status || recoveryCase.status === filters.status)
      .filter((recoveryCase) => !filters.scenarioType || recoveryCase.scenarioType === filters.scenarioType)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return filters.limit ? cases.slice(0, filters.limit) : cases;
  }

  async save(recoveryCase: PersistedRecoveryCase): Promise<void> {
    this.cases.set(recoveryCase.caseId, recoveryCase);
  }

  async update(caseId: string, update: Partial<PersistedRecoveryCase>): Promise<PersistedRecoveryCase> {
    const current = this.cases.get(caseId);
    if (!current) throw new Error(`Recovery case ${caseId} was not found`);
    const next = { ...current, ...update, updatedAt: new Date().toISOString() };
    this.cases.set(caseId, next);
    return next;
  }

  async transition(
    caseId: string,
    fromStatuses: readonly PersistedRecoveryCase["status"][],
    toStatus: PersistedRecoveryCase["status"],
    update: Partial<PersistedRecoveryCase> = {}
  ): Promise<PersistedRecoveryCase | undefined> {
    const current = this.cases.get(caseId);
    if (!current || !fromStatuses.includes(current.status)) return undefined;
    return this.update(caseId, { ...update, status: toStatus });
  }

  async failAttempt(caseId: string, toStatus: "FAILED" | "STOPPED"): Promise<PersistedRecoveryCase> {
    const current = this.cases.get(caseId);
    if (!current) throw new Error(`Recovery case ${caseId} was not found`);
    if (current.status === "RECOVERED" || current.status === "FAILED" || current.status === "STOPPED") return current;
    return this.update(caseId, { status: toStatus, previousAttempts: current.previousAttempts + 1 });
  }
}
