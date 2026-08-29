import { env } from "../../config/env.js";
import { FetchAiProvider } from "./fetchAiProvider.js";
import type { AiProvider } from "../types.js";

export const createConfiguredAiProvider = (): AiProvider | undefined => {
  if (!env.ai.enabled || !env.ai.provider || !env.ai.model) {
    return undefined;
  }

  const endpoint = new URL(env.ai.provider);
  const isOllama = ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  const format = isOllama ? "ollama" : endpoint.hostname === "api.openai.com" ? "openai-responses" : "recoveriq";
  const providerEndpoint = isOllama ? new URL("/api/chat", endpoint).toString() : env.ai.provider;
  return new FetchAiProvider(providerEndpoint, env.ai.apiKey ?? "", isOllama ? "ollama" : "configured", env.ai.model, undefined, {
    format,
    allowInsecureLocalhost: isOllama,
    allowUnstructuredOllama: isOllama
  });
};
