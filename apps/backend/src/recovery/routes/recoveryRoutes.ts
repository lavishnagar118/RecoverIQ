import { Router } from "express";

import { recoveryDevelopmentService } from "../services/recoveryDevelopmentService.js";

const defaultCaseLimit = 25;
const maximumCaseLimit = 100;

const parseCaseLimit = (value: unknown): number => {
  if (value === undefined) {
    return defaultCaseLimit;
  }

  if (typeof value !== "string") {
    throw new Error("limit must be a single integer query parameter");
  }

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1 || limit > maximumCaseLimit) {
    throw new Error(`limit must be an integer between 1 and ${maximumCaseLimit}`);
  }

  return limit;
};

export const recoveryRouter = Router();

recoveryRouter.get("/summary", (_req, res) => {
  res.status(200).json(recoveryDevelopmentService.getSummary());
});

recoveryRouter.get("/cases", (req, res) => {
  try {
    const limit = parseCaseLimit(req.query.limit);
    res.status(200).json(recoveryDevelopmentService.listCases(limit));
  } catch (error) {
    res.status(400).json({
      error: {
        message: error instanceof Error ? error.message : "Invalid case list request",
        statusCode: 400
      }
    });
  }
});
