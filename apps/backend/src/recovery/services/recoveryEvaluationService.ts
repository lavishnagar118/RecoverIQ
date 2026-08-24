import {
  calculateTotalAmountAtRisk,
  type RecoveryCase,
  type RecoveryStatus,
  recoveryStatuses,
  type RecoveryScenarioType,
  recoveryScenarioTypes
} from "../domain/recoveryCase.js";

export const defaultRecoverableThreshold = 0.35;

export interface RecoveryEvaluationSummary {
  datasetType: "synthetic";
  totalCases: number;
  totalAmountAtRisk: number;
  averageAmountAtRisk: number;
  numberOfRecoverableCases: number;
  recoverableThreshold: number;
  totalExpectedRecoveryValue: number;
  statusDistribution: Record<RecoveryStatus, number>;
  scenarioDistribution: Record<RecoveryScenarioType, number>;
}

const buildStatusDistribution = (): Record<RecoveryStatus, number> =>
  Object.fromEntries(recoveryStatuses.map((status) => [status, 0])) as Record<RecoveryStatus, number>;

const buildScenarioDistribution = (): Record<RecoveryScenarioType, number> =>
  Object.fromEntries(recoveryScenarioTypes.map((scenarioType) => [scenarioType, 0])) as Record<
    RecoveryScenarioType,
    number
  >;

export const evaluateRecoveryBatch = (
  cases: readonly RecoveryCase[],
  recoverableThreshold = defaultRecoverableThreshold
): RecoveryEvaluationSummary => {
  if (!Number.isFinite(recoverableThreshold) || recoverableThreshold < 0 || recoverableThreshold > 1) {
    throw new Error("recoverableThreshold must be between 0 and 1");
  }

  const totalCases = cases.length;
  const totalAmountAtRisk = calculateTotalAmountAtRisk(cases);
  const totalExpectedRecoveryValue = cases.reduce(
    (total, recoveryCase) => total + recoveryCase.expectedRecoveryValue,
    0
  );
  const statusDistribution = buildStatusDistribution();
  const scenarioDistribution = buildScenarioDistribution();

  for (const recoveryCase of cases) {
    statusDistribution[recoveryCase.status] += 1;
    scenarioDistribution[recoveryCase.scenarioType] += 1;
  }

  return {
    datasetType: "synthetic",
    totalCases,
    totalAmountAtRisk,
    averageAmountAtRisk: totalCases === 0 ? 0 : Math.round(totalAmountAtRisk / totalCases),
    numberOfRecoverableCases: cases.filter(
      (recoveryCase) => recoveryCase.recoveryProbability >= recoverableThreshold
    ).length,
    recoverableThreshold,
    totalExpectedRecoveryValue,
    statusDistribution,
    scenarioDistribution
  };
};
