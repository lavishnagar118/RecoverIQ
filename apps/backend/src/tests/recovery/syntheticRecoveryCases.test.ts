import { describe, expect, it } from "vitest";

import {
  defaultSyntheticRecoveryBatchSize,
  generateSyntheticRecoveryCases
} from "../../recovery/synthetic/syntheticRecoveryCases.js";

describe("synthetic recovery case generation", () => {
  it("generates the requested synthetic batch size", () => {
    const cases = generateSyntheticRecoveryCases(defaultSyntheticRecoveryBatchSize, 12345);

    expect(cases).toHaveLength(1_000);
  });

  it("is reproducible with the same seed", () => {
    const firstRun = generateSyntheticRecoveryCases(20, 999);
    const secondRun = generateSyntheticRecoveryCases(20, 999);

    expect(secondRun).toEqual(firstRun);
  });

  it("keeps simulated outcome labels separate from scoring fields", () => {
    const [recoveryCase] = generateSyntheticRecoveryCases(1, 12345);

    expect(recoveryCase.syntheticMetadata.datasetType).toBe("synthetic");
    expect(recoveryCase.syntheticMetadata.simulatedOutcomeLabel).toMatch(/^SIMULATED_/);
    expect(recoveryCase.scoringReasons.length).toBeGreaterThan(0);
  });

  it("stores synthetic monetary values as integer paise with realistic INR display values", () => {
    const cases = generateSyntheticRecoveryCases(40, 20260821);

    for (const recoveryCase of cases) {
      expect(Number.isSafeInteger(recoveryCase.amountAtRisk)).toBe(true);
      expect(Number.isSafeInteger(recoveryCase.expectedRecoveryValue)).toBe(true);
      expect(recoveryCase.amountAtRisk % 100).toBe(0);
      expect(recoveryCase.amountAtRisk).toBeGreaterThanOrEqual(500_000);
    }
  });
});
