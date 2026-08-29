import type { ErrorRequestHandler, RequestHandler } from "express";

import { env } from "../config/env.js";

interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  expose?: boolean;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`) as HttpError;
  error.statusCode = 404;
  error.expose = true;
  next(error);
};

export const errorHandler: ErrorRequestHandler = (error: HttpError, _req, res, _next) => {
  const statusCode = error.statusCode ?? error.status ?? 500;
  const isServerError = statusCode >= 500;

  if (isServerError && env.nodeEnv !== "test") {
    console.error("[recoveriq] unhandled request error", error.message, error.stack ?? "");
  }

  res.status(statusCode).json({
    error: {
      message: isServerError && !error.expose ? "Internal server error" : error.message,
      statusCode,
      ...(env.nodeEnv === "development" && error.stack ? { stack: error.stack } : {})
    }
  });
};
