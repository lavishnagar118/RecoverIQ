import type { SyntheticRecoveryCase } from "../synthetic/syntheticRecoveryCases.js";
import {
  defaultSyntheticRecoveryBatchSize,
  defaultSyntheticRecoverySeed,
  generateSyntheticRecoveryCases
} from "../synthetic/syntheticRecoveryCases.js";
import {
  evaluateRecoveryBatch,
  type RecoveryEvaluationSummary
} from "./recoveryEvaluationService.js";

export interface DevelopmentRecoverySummary extends RecoveryEvaluationSummary {
  seed: number;
  generatedCaseCount: number;
}

export interface DevelopmentRecoveryCaseList {
  datasetType: "synthetic";
  seed: number;
  totalAvailable: number;
  limit: number;
  cases: SyntheticRecoveryCase[];
}

let cachedCases: SyntheticRecoveryCase[] | undefined;

const getSyntheticCases = (): SyntheticRecoveryCase[] => {
  if (!cachedCases) {
    cachedCases = generateSyntheticRecoveryCases(
      defaultSyntheticRecoveryBatchSize,
      defaultSyntheticRecoverySeed
    );
  }

  return cachedCases;
};

export const recoveryDevelopmentService = {
  getSummary(): DevelopmentRecoverySummary {
    const cases = getSyntheticCases();

    return {
      ...evaluateRecoveryBatch(cases),
      seed: defaultSyntheticRecoverySeed,
      generatedCaseCount: cases.length
    };
  },

  listCases(limit: number): DevelopmentRecoveryCaseList {
    const cases = getSyntheticCases();

    return {
      datasetType: "synthetic",
      seed: defaultSyntheticRecoverySeed,
      totalAvailable: cases.length,
      limit,
      cases: cases.slice(0, limit)
    };
  }
};
