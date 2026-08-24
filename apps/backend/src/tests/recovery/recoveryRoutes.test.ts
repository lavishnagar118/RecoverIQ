import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";

describe("recovery development API", () => {
  it("returns a synthetic recovery summary", async () => {
    const response = await request(createApp()).get("/api/recovery/summary").expect(200);

    expect(response.body).toMatchObject({
      datasetType: "synthetic",
      seed: expect.any(Number),
      totalCases: 1_000,
      generatedCaseCount: 1_000,
      statusDistribution: expect.any(Object)
    });
    expect(response.body.totalAmountAtRisk).toBeGreaterThan(0);
    expect(response.body.totalExpectedRecoveryValue).toBeGreaterThan(0);
  });

  it("returns a limited list of synthetic recovery cases", async () => {
    const response = await request(createApp()).get("/api/recovery/cases?limit=10").expect(200);

    expect(response.body.totalAvailable).toBe(1_000);
    expect(response.body.limit).toBe(10);
    expect(response.body.cases).toHaveLength(10);
    expect(response.body.cases[0]).toMatchObject({
      caseId: expect.any(String),
      amountAtRisk: expect.any(Number),
      syntheticMetadata: {
        datasetType: "synthetic",
        simulatedOutcomeLabel: expect.stringMatching(/^SIMULATED_/)
      }
    });
  });

  it("rejects invalid case limits", async () => {
    const response = await request(createApp()).get("/api/recovery/cases?limit=500").expect(400);

    expect(response.body.error.message).toBe("limit must be an integer between 1 and 100");
  });
});
