import { AiProviderError, type AiProvider, type AiProviderRequest, type AiProviderResult } from "./aiProvider.js";

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<FetchResponse>;

export interface FetchAiProviderOptions {
  allowInsecureLocalhost?: boolean;
}

const isAllowedLocalHttpEndpoint = (url: URL, options: FetchAiProviderOptions): boolean =>
  options.allowInsecureLocalhost === true &&
  url.protocol === "http:" &&
  ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

export const validateProviderEndpoint = (
  endpoint: string,
  options: FetchAiProviderOptions = {}
): URL => {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AiProviderError("AI provider endpoint is invalid", "UNAVAILABLE");
  }

  if (url.protocol !== "https:" && !isAllowedLocalHttpEndpoint(url, options)) {
    throw new AiProviderError("AI provider endpoint must use HTTPS", "UNAVAILABLE");
  }

  return url;
};

export class FetchAiProvider implements AiProvider {
  private readonly endpointUrl: URL;

  constructor(
    endpoint: string,
    private readonly apiKey: string,
    private readonly providerName: string,
    private readonly model: string,
    private readonly fetchImpl: FetchLike = fetch,
    options: FetchAiProviderOptions = {}
  ) {
    this.endpointUrl = validateProviderEndpoint(endpoint, options);
  }

  async generateStructured(request: AiProviderRequest): Promise<AiProviderResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpointUrl.toString(), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          systemPrompt: request.systemPrompt,
          developerPrompt: request.developerPrompt,
          context: request.context,
          outputSchema: request.outputSchema,
          tools: request.tools,
          maxOutputTokens: request.maxOutputTokens
        })
      });

      if (!response.ok) {
        throw new AiProviderError(
          `AI provider returned HTTP ${response.status}`,
          "UNAVAILABLE"
        );
      }

      const payload = await response.json();
      if (!payload || typeof payload !== "object" || !("output" in payload)) {
        throw new AiProviderError("AI provider response did not contain output", "MALFORMED_RESPONSE");
      }

      return {
        output: payload.output,
        provider: this.providerName,
        model: this.model,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AiProviderError("AI provider request timed out", "TIMEOUT");
      }

      throw new AiProviderError("AI provider is unavailable", "UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }
}
