import { Router } from "express";

import { env } from "../config/env.js";
import { isMongoConfigured } from "../config/mongo.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "recoveriq-backend",
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
    dependencies: {
      mongodb: {
        configured: isMongoConfigured()
      }
    }
  });
});
