import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const repositoryRootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..", ".env");

dotenv.config({ path: repositoryRootEnvPath });

const allowedNodeEnvs = ["development", "test", "production"] as const;

type NodeEnv = (typeof allowedNodeEnvs)[number];

export interface EnvConfig {
  nodeEnv: NodeEnv;
  port: number;
  mongoDbUri?: string;
  razorpay: {
    mode?: "test";
    keyId?: string;
    keySecret?: string;
    webhookSecret?: string;
    apiBaseUrl: string;
    requestTimeoutMs: number;
  };
  ai: {
    enabled: boolean;
    provider?: string;
    apiKey?: string;
    model?: string;
    requestTimeoutMs: number;
    maxOutputTokens: number;
  };
}

const normalizeNodeEnv = (value: string | undefined): NodeEnv => {
  if (allowedNodeEnvs.includes(value as NodeEnv)) {
    return value as NodeEnv;
  }

  return "development";
};

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return 5000;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
};

const optionalString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const parseBoolean = (value: string | undefined): boolean => value?.toLowerCase() === "true";

const parsePositiveInteger = (value: string | undefined, fallback: number, fieldName: string): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
};

const parseRazorpayMode = (value: string | undefined): "test" | undefined => {
  const mode = optionalString(value);
  if (!mode) return undefined;
  if (mode !== "test") throw new Error("RAZORPAY_MODE must be test");
  return "test";
};

export const env: EnvConfig = {
  nodeEnv: normalizeNodeEnv(process.env.NODE_ENV),
  port: parsePort(process.env.PORT),
  mongoDbUri: optionalString(process.env.MONGODB_URI),
  razorpay: {
    mode: parseRazorpayMode(process.env.RAZORPAY_MODE),
    keyId: optionalString(process.env.RAZORPAY_KEY_ID),
    keySecret: optionalString(process.env.RAZORPAY_KEY_SECRET),
    webhookSecret: optionalString(process.env.RAZORPAY_WEBHOOK_SECRET),
    apiBaseUrl: optionalString(process.env.RAZORPAY_API_BASE_URL) ?? "https://api.razorpay.com",
    requestTimeoutMs: parsePositiveInteger(
      process.env.RAZORPAY_REQUEST_TIMEOUT_MS,
      10_000,
      "RAZORPAY_REQUEST_TIMEOUT_MS"
    )
  },
  ai: {
    enabled: parseBoolean(process.env.AI_ENABLED),
    provider: optionalString(process.env.AI_PROVIDER),
    apiKey: optionalString(process.env.AI_API_KEY),
    model: optionalString(process.env.AI_MODEL),
    requestTimeoutMs: parsePositiveInteger(
      process.env.AI_REQUEST_TIMEOUT_MS,
      8_000,
      "AI_REQUEST_TIMEOUT_MS"
    ),
    maxOutputTokens: parsePositiveInteger(
      process.env.AI_MAX_OUTPUT_TOKENS,
      800,
      "AI_MAX_OUTPUT_TOKENS"
    )
  }
};
