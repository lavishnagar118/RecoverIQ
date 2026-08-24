import { describe, expect, it } from "vitest";

import { FetchAiProvider, validateProviderEndpoint } from "../../ai/providers/fetchAiProvider.js";
import { AiProviderError } from "../../ai/providers/aiProvider.js";
import type { AiProviderRequest } from "../../ai/types.js";

const request: AiProviderRequest = {
  systemPrompt: "system",
  developerPrompt: "developer",
  context: { dataClassification: "synthetic" },
  outputSchema: { type: "object" },
  tools: [],
  timeoutMs: 20,
  maxOutputTokens: 20
};

describe("fetch AI provider security", () => {
  it("accepts HTTPS endpoints", () => {
    expect(validateProviderEndpoint("https://provider.example/v1/advice").protocol).toBe("https:");
  });

  it("rejects HTTP endpoints unless explicitly allowed localhost", () => {
    expect(() => validateProviderEndpoint("http://provider.example/v1/advice")).toThrow(
      "AI provider endpoint must use HTTPS"
    );
    expect(() =>
      validateProviderEndpoint("http://localhost:8787/advice", { allowInsecureLocalhost: true })
    ).not.toThrow();
    expect(() =>
      validateProviderEndpoint("http://localhost:8787/advice")
    ).toThrow("AI provider endpoint must use HTTPS");
  });

  it("includes authorization only on an HTTPS request", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const provider = new FetchAiProvider(
      "https://provider.example/advice",
      "test-api-key",
      "fake",
      "fake-model",
      async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return { ok: true, status: 200, json: async () => ({ output: {} }) };
      }
    );

    await provider.generateStructured(request);
    expect(capturedUrl).toBe("https://provider.example/advice");
    expect(capturedInit?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer test-api-key"
    });
  });

  it("does not expose API keys in endpoint or provider errors", async () => {
    expect(() => new FetchAiProvider("http://provider.example", "super-secret", "fake", "model")).toThrowError(
      expect.not.stringContaining("super-secret")
    );

    const provider = new FetchAiProvider(
      "https://provider.example/advice",
      "super-secret",
      "fake",
      "model",
      async () => {
        throw new Error("network failure");
      }
    );

    await expect(provider.generateStructured(request)).rejects.toThrowError(
      expect.not.stringContaining("super-secret")
    );
  });

  it("falls back through AbortController timeout errors", async () => {
    const provider = new FetchAiProvider(
      "https://provider.example/advice",
      "test-key",
      "fake",
      "model",
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })
    );

    await expect(provider.generateStructured({ ...request, timeoutMs: 1 })).rejects.toMatchObject({
      name: "AiProviderError",
      code: "TIMEOUT"
    });
  });

  it("surfaces provider HTTP and malformed-response errors without raw payloads", async () => {
    const httpFailure = new FetchAiProvider(
      "https://provider.example/advice",
      "test-key",
      "fake",
      "model",
      async () => ({ ok: false, status: 503, json: async () => ({ secret: "hidden" }) })
    );
    await expect(httpFailure.generateStructured(request)).rejects.toEqual(
      new AiProviderError("AI provider returned HTTP 503", "UNAVAILABLE")
    );

    const malformed = new FetchAiProvider(
      "https://provider.example/advice",
      "test-key",
      "fake",
      "model",
      async () => ({ ok: true, status: 200, json: async () => ({ secret: "hidden" }) })
    );
    await expect(malformed.generateStructured(request)).rejects.toEqual(
      new AiProviderError("AI provider response did not contain output", "MALFORMED_RESPONSE")
    );
  });
});
