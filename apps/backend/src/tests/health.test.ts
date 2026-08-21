import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";

describe("GET /api/health", () => {
  it("returns a structured health response without requiring MongoDB", async () => {
    const response = await request(createApp()).get("/api/health").expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      service: "recoveriq-backend",
      dependencies: {
        mongodb: {
          configured: expect.any(Boolean)
        }
      }
    });
    expect(response.body.environment).toEqual(expect.any(String));
    expect(response.body.timestamp).toEqual(expect.any(String));
  });
});
