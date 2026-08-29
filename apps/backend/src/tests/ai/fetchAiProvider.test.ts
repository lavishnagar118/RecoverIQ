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

  it("adapts OpenAI Responses structured output to the internal output contract", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const provider = new FetchAiProvider(
      "https://api.openai.com/v1/responses",
      "test-key",
      "openai",
      "gpt-5.6",
      async (_url, init) => {
        capturedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            output: [
              {
                type: "reasoning",
                content: []
              },
              {
                type: "message",
                content: [{ type: "output_text", text: '{"message":"ok"}' }]
              }
            ]
          })
        };
      },
      { format: "openai-responses" }
    );

    await expect(provider.generateStructured(request)).resolves.toMatchObject({
      output: { message: "ok" },
      provider: "openai",
      model: "gpt-5.6"
    });
    expect(capturedBody).toMatchObject({
      model: "gpt-5.6",
      store: false,
      max_output_tokens: 20,
      text: {
        format: {
          type: "json_schema",
          strict: true
        }
      }
    });
    expect(capturedBody?.input).toEqual([
      {
        role: "user",
        content: 'RecoverIQ context:\n{"dataClassification":"synthetic"}'
      }
    ]);
  });

  it("calls Ollama with local structured chat output and no authorization header", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const provider = new FetchAiProvider(
      "http://localhost:11434/api/chat",
      "",
      "ollama",
      "qwen2.5:3b",
      async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: '{"message":"ok"}' } })
        };
      },
      { format: "ollama", allowInsecureLocalhost: true }
    );

    await expect(provider.generateStructured(request)).resolves.toMatchObject({
      output: { message: "ok" },
      provider: "ollama",
      model: "qwen2.5:3b"
    });
    expect(capturedUrl).toBe("http://localhost:11434/api/chat");
    expect(capturedInit?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: "qwen2.5:3b",
      stream: false,
      format: request.outputSchema,
      messages: [
        { role: "system", content: "system\n\ndeveloper" },
        { role: "user", content: expect.stringContaining("RecoverIQ context and conversation:") }
      ]
    });
  });

  it("rejects malformed Ollama structured output", async () => {
    const provider = new FetchAiProvider(
      "http://localhost:11434/api/chat",
      "",
      "ollama",
      "qwen2.5:3b",
      async () => ({ ok: true, status: 200, json: async () => ({ message: { content: "not-json" } }) }),
      { format: "ollama", allowInsecureLocalhost: true }
    );

    await expect(provider.generateStructured(request)).rejects.toMatchObject({
      name: "AiProviderError",
      code: "MALFORMED_RESPONSE"
    });
  });

  it("retries transient HTTP 429 responses", async () => {
    let calls = 0;
    const provider = new FetchAiProvider(
      "http://localhost:11434/api/chat",
      "",
      "ollama",
      "qwen2.5:3b",
      async () => {
        calls += 1;
        return calls < 3
          ? { ok: false, status: 429, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({ message: { content: '{"message":"ok"}' } }) };
      },
      { format: "ollama", allowInsecureLocalhost: true }
    );

    await expect(provider.generateStructured(request)).resolves.toMatchObject({ output: { message: "ok" } });
    expect(calls).toBe(3);
  });
});
