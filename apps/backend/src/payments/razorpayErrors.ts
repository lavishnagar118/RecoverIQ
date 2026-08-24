export type RazorpayErrorCode =
  | "CONFIGURATION_ERROR"
  | "TIMEOUT"
  | "AUTHENTICATION_ERROR"
  | "CLIENT_ERROR"
  | "SERVER_ERROR"
  | "INVALID_RESPONSE";

export class RazorpayProviderError extends Error {
  readonly statusCode: number;
  readonly expose = true;

  constructor(
    readonly code: RazorpayErrorCode,
    message: string,
    statusCode?: number,
    readonly retryable = false
  ) {
    super(message);
    this.name = "RazorpayProviderError";
    this.statusCode =
      statusCode ??
      (code === "CONFIGURATION_ERROR" || code === "TIMEOUT" || code === "SERVER_ERROR" ? 503 : 502);
  }
}
