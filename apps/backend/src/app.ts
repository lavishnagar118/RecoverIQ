import express from "express";

import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { recoveryRouter } from "./recovery/index.js";
import { healthRouter } from "./routes/health.js";

export const createApp = () => {
  const app = express();

  app.use(express.json());
  app.use(requestLogger);

  app.use("/api/health", healthRouter);
  app.use("/api/recovery", recoveryRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export const app = createApp();
