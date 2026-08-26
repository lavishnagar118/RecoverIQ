import { env } from "../config/env.js";
import { RazorpayProviderError } from "./razorpayErrors.js";
import {
  mapPaymentLinksListResponse,
  mapPaymentLinkRequest,
  mapPaymentLinkResponse
} from "./paymentLinkMapper.js";
import type {
  CreatePaymentLinkRequest,
  RazorpayPaymentLink,
  RazorpayProvider
} from "./razorpayTypes.js";

export class RazorpayHttpProvider implements RazorpayProvider {
  constructor(
    private readonly config = env.razorpay,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async createPaymentLink(request: CreatePaymentLinkRequest): Promise<RazorpayPaymentLink> {
    return mapPaymentLinkResponse(
      await this.requestRaw("/v1/payment_links", {
        method: "POST",
        body: mapPaymentLinkRequest(request)
      })
    );
  }

  async fetchPaymentLink(paymentLinkId: string): Promise<RazorpayPaymentLink> {
    return mapPaymentLinkResponse(
      await this.requestRaw(`/v1/payment_links/${encodeURIComponent(paymentLinkId)}`, { method: "GET" })
    );
  }

  async findPaymentLinksByReferenceId(referenceId: string): Promise<RazorpayPaymentLink[]> {
    return mapPaymentLinksListResponse(
      await this.requestRaw(
        `/v1/payment_links?reference_id=${encodeURIComponent(referenceId)}`,
        { method: "GET" }
      )
    );
  }

  private async requestRaw(
    path: string,
    options: { method: "GET" | "POST"; body?: Record<string, unknown> }
  ): Promise<unknown> {
    validateRazorpayTestModeConfig(this.config);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.config.apiBaseUrl.replace(/\/$/, "")}${path}`,
        {
          method: options.method,
          signal: controller.signal,
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${this.config.keyId}:${this.config.keySecret}`
            ).toString("base64")}`,
            "Content-Type": "application/json"
          },
          body: options.body ? JSON.stringify(options.body) : undefined
        }
      );
      if (!response.ok) {
        const code =
          response.status === 401 || response.status === 403
            ? "AUTHENTICATION_ERROR"
            : response.status >= 500
              ? "SERVER_ERROR"
              : "CLIENT_ERROR";
        throw new RazorpayProviderError(
          code,
          `Razorpay request failed with status ${response.status}`,
          response.status,
          code === "SERVER_ERROR"
        );
      }
      try {
        return await response.json();
      } catch {
        throw new RazorpayProviderError("INVALID_RESPONSE", "Razorpay returned an invalid response");
      }
    } catch (error) {
      if (error instanceof RazorpayProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new RazorpayProviderError("TIMEOUT", "Razorpay request timed out", undefined, true);
      }
      throw new RazorpayProviderError(
        "SERVER_ERROR",
        "Razorpay request could not be completed",
        undefined,
        true
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const validateRazorpayTestModeConfig = (config: typeof env.razorpay): void => {
  let url: URL;
  try {
    url = new URL(config.apiBaseUrl);
  } catch {
    throw new RazorpayProviderError("CONFIGURATION_ERROR", "Razorpay API base URL is invalid");
  }
  if (config.mode !== "test") {
    throw new RazorpayProviderError("CONFIGURATION_ERROR", "RAZORPAY_MODE=test is required");
  }
  if (url.protocol !== "https:" || !["api.razorpay.com", "api.razorpay.in"].includes(url.hostname)) {
    throw new RazorpayProviderError(
      "CONFIGURATION_ERROR",
      "Razorpay API base URL must be the official Test Mode API host"
    );
  }
  if (
    !config.keyId ||
    !config.keySecret ||
    !config.keyId.startsWith("rzp_test_") ||
    config.keySecret.startsWith("rzp_live_")
  ) {
    throw new RazorpayProviderError(
      "CONFIGURATION_ERROR",
      "Razorpay credentials do not appear to be Test Mode credentials"
    );
  }
};
