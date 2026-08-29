import express from "express";

import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { recoveryRouter } from "./recovery/index.js";
import { healthRouter } from "./routes/health.js";
import { getRecoveryRuntime } from "./recovery/execution/recoveryRuntime.js";
import { recoveryOperationsRouter } from "./recovery/routes/recoveryOperationsRoutes.js";

export const createApp = () => {
  const app = express();

  app.post("/api/webhooks/razorpay", express.raw({ type: "application/json" }), async (req, res, next) => {
    try {
      const result = await (await getRecoveryRuntime()).webhook.handle(
        req.body as Buffer,
        req.header("X-Razorpay-Signature") ?? undefined,
        req.header("x-razorpay-event-id") ?? undefined
      );
      res.status(200).json({ status: result });
    } catch (error) {
      next(error);
    }
  });
  app.use(express.json());
  app.use(requestLogger);

  app.use("/api/health", healthRouter);
  app.use("/api/recovery", recoveryRouter);
  app.use("/api/recovery/operations", recoveryOperationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export const app = createApp();
