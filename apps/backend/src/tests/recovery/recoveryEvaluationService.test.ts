import { describe, expect, it } from "vitest";

import { evaluateRecoveryBatch } from "../../recovery/services/recoveryEvaluationService.js";
import { generateSyntheticRecoveryCases } from "../../recovery/synthetic/syntheticRecoveryCases.js";

describe("recovery evaluation service", () => {
  it("aggregates batch amount, expected recovery, recoverable count, and distributions", () => {
    const cases = generateSyntheticRecoveryCases(50, 2026);
    const summary = evaluateRecoveryBatch(cases, 0.35);

    expect(summary.datasetType).toBe("synthetic");
    expect(summary.totalCases).toBe(50);
    expect(summary.totalAmountAtRisk).toBeGreaterThan(0);
    expect(summary.averageAmountAtRisk).toBe(Math.round(summary.totalAmountAtRisk / 50));
    expect(summary.totalExpectedRecoveryValue).toBeGreaterThan(0);
    expect(summary.numberOfRecoverableCases).toBeGreaterThan(0);
    expect(summary.statusDistribution.AT_RISK).toBeGreaterThan(0);
    expect(summary.scenarioDistribution.PAYMENT_FAILED + summary.scenarioDistribution.CHECKOUT_ABANDONED).toBe(
      50
    );
  });
});
