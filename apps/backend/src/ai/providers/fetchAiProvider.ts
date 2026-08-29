import { AiProviderError, type AiProvider, type AiProviderRequest, type AiProviderResult } from "./aiProvider.js";

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<FetchResponse>;

export interface FetchAiProviderOptions {
  allowInsecureLocalhost?: boolean;
  format?: "recoveriq" | "openai-responses" | "ollama";
  allowUnstructuredOllama?: boolean;
}

const isAllowedLocalHttpEndpoint = (url: URL, options: FetchAiProviderOptions): boolean =>
  options.allowInsecureLocalhost === true &&
  url.protocol === "http:" &&
  ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

export const validateProviderEndpoint = (endpoint: string, options: FetchAiProviderOptions = {}): URL => {
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
  private readonly providerFormat: "recoveriq" | "openai-responses" | "ollama";
  private readonly allowUnstructuredOllama: boolean;

  constructor(
    endpoint: string,
    private readonly apiKey: string,
    private readonly providerName: string,
    private readonly model: string,
    private readonly fetchImpl: FetchLike = fetch,
    options: FetchAiProviderOptions = {}
  ) {
    this.endpointUrl = validateProviderEndpoint(endpoint, options);
    this.providerFormat = options.format ?? "recoveriq";
    this.allowUnstructuredOllama = options.allowUnstructuredOllama === true;
  }

  async generateStructured(request: AiProviderRequest): Promise<AiProviderResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      let response: FetchResponse;
      for (let attempt = 0; ; attempt += 1) {
        response = await this.fetchImpl(this.endpointUrl.toString(), {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            ...(this.providerFormat === "ollama" ? {} : { authorization: `Bearer ${this.apiKey}` })
          },
          body: JSON.stringify(this.buildBody(request))
        });
        if (response.status !== 429 || attempt >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }

      if (!response.ok) {
        throw new AiProviderError(`AI provider returned HTTP ${response.status}`, "UNAVAILABLE");
      }

      const payload = await response.json();
      const output = this.providerFormat === "ollama"
        ? parseOllamaOutput(payload, this.allowUnstructuredOllama)
        : this.providerFormat === "openai-responses"
          ? parseOpenAiResponsesOutput(payload)
          : parseRecoverIqOutput(payload);

      return {
        output,
        provider: this.providerName,
        model: this.model,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiProviderError("AI provider request timed out", "TIMEOUT");
      }
      throw new AiProviderError("AI provider is unavailable", "UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildBody(request: AiProviderRequest): unknown {
    if (this.providerFormat === "ollama") {
      return {
        model: this.model,
        stream: false,
        format: request.outputSchema,
        messages: [
          {
            role: "system",
            content: `${request.systemPrompt}\n\n${request.developerPrompt}`
          },
          {
            role: "user",
            content: `RecoverIQ context and conversation:\n${JSON.stringify(request.context)}`
          }
        ],
        options: { num_predict: request.maxOutputTokens }
      };
    }

    if (this.providerFormat === "openai-responses") {
      return {
        model: this.model,
        instructions: `${request.systemPrompt}\n\n${request.developerPrompt}`,
        input: [{
          role: "user",
          content: `RecoverIQ context:\n${JSON.stringify(request.context)}`
        }],
        text: {
          format: {
            type: "json_schema",
            name: "recoveriq_response",
            strict: true,
            schema: request.outputSchema
          }
        },
        store: false,
        max_output_tokens: request.maxOutputTokens
      };
    }

    return {
      model: this.model,
      systemPrompt: request.systemPrompt,
      developerPrompt: request.developerPrompt,
      context: request.context,
      outputSchema: request.outputSchema,
      tools: request.tools,
      maxOutputTokens: request.maxOutputTokens
    };
  }
}

const parseRecoverIqOutput = (payload: unknown): unknown => {
  if (!payload || typeof payload !== "object" || !("output" in payload)) {
    throw new AiProviderError("AI provider response did not contain output", "MALFORMED_RESPONSE");
  }
  return payload.output;
};

const parseOllamaOutput = (payload: unknown, allowUnstructured: boolean): unknown => {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("message" in payload) ||
    !payload.message ||
    typeof payload.message !== "object" ||
    !("content" in payload.message) ||
    typeof payload.message.content !== "string"
  ) {
    throw new AiProviderError("Ollama response did not contain message content", "MALFORMED_RESPONSE");
  }

  try {
    return JSON.parse(payload.message.content);
  } catch {
    if (allowUnstructured) {
      return {
        message: payload.message.content,
        intent: "UNKNOWN",
        recommendation: null,
        requiresConfirmation: false,
        action: null,
        reasoning: "The local model returned plain text instead of the requested structured metadata. No action was accepted.",
        confidence: 0
      };
    }
    throw new AiProviderError("Ollama returned invalid structured output", "MALFORMED_RESPONSE");
  }
};

const parseOpenAiResponsesOutput = (payload: unknown): unknown => {
  if (!payload || typeof payload !== "object" || !("output" in payload) || !Array.isArray(payload.output)) {
    throw new AiProviderError("AI provider response did not contain structured output", "MALFORMED_RESPONSE");
  }

  for (const item of payload.output) {
    if (!item || typeof item !== "object" || !("type" in item) || item.type !== "message" || !("content" in item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (content && typeof content === "object" && "type" in content && content.type === "output_text" && "text" in content && typeof content.text === "string") {
        try {
          return JSON.parse(content.text);
        } catch {
          throw new AiProviderError("AI provider returned invalid structured output", "MALFORMED_RESPONSE");
        }
      }
    }
  }

  throw new AiProviderError("AI provider response did not contain structured output", "MALFORMED_RESPONSE");
};
