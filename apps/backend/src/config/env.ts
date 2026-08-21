import dotenv from "dotenv";

dotenv.config();

const allowedNodeEnvs = ["development", "test", "production"] as const;

type NodeEnv = (typeof allowedNodeEnvs)[number];

export interface EnvConfig {
  nodeEnv: NodeEnv;
  port: number;
  mongoDbUri?: string;
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

export const env: EnvConfig = {
  nodeEnv: normalizeNodeEnv(process.env.NODE_ENV),
  port: parsePort(process.env.PORT),
  mongoDbUri: optionalString(process.env.MONGODB_URI)
};
