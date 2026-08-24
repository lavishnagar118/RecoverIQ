export type {
  AiProvider,
  AiProviderRequest,
  AiProviderResult
} from "../types.js";

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly code: "TIMEOUT" | "UNAVAILABLE" | "MALFORMED_RESPONSE"
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
