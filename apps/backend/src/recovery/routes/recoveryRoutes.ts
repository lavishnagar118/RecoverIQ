import { Router } from "express";

import { recoveryDevelopmentService } from "../services/recoveryDevelopmentService.js";
import { getRecoveryRuntime } from "../execution/recoveryRuntime.js";
import { selectRecoveryAction } from "../decision/recoveryActionEngine.js";

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

recoveryRouter.get("/cases/:caseId", async (req, res, next) => {
  try {
    const runtime = await getRecoveryRuntime();
    const recoveryCase = await runtime.cases.getById(req.params.caseId);
    if (!recoveryCase) return res.status(404).json({ error: { message: "Recovery case was not found", statusCode: 404 } });
    const execution = await runtime.executions.findByKey(
      `${req.params.caseId}:${recoveryCase.previousAttempts + 1}:CREATE_PAYMENT_LINK`
    );
    return res.status(200).json({ case: recoveryCase, execution });
  } catch (error) {
    return next(error);
  }
});

recoveryRouter.post("/cases/:caseId/actions", async (req, res, next) => {
  try {
    if (req.body?.action !== "CREATE_PAYMENT_LINK") {
      return res.status(400).json({ error: { message: "Only CREATE_PAYMENT_LINK is supported", statusCode: 400 } });
    }
    const runtime = await getRecoveryRuntime();
    const recoveryCase = await runtime.cases.getById(req.params.caseId);
    if (!recoveryCase) {
      return res.status(404).json({ error: { message: "Recovery case was not found", statusCode: 404 } });
    }
    const decision = selectRecoveryAction(recoveryCase);
    if (decision.selectedAction !== "CREATE_PAYMENT_LINK") {
      return res.status(409).json({
        error: { message: `Deterministic decision selected ${decision.selectedAction}`, statusCode: 409 },
        decision
      });
    }
    if (recoveryCase.status !== "ACTION_SELECTED") {
      await runtime.cases.update(recoveryCase.caseId, { status: "ACTION_SELECTED", selectedAction: decision.selectedAction });
    }
    const execution = await runtime.execution.createPaymentLink(req.params.caseId);
    return res.status(200).json({
      action: execution.action,
      status: execution.status,
      caseId: execution.caseId,
      executionKey: execution.executionKey,
      paymentLinkId: execution.razorpayPaymentLinkId,
      shortUrl: execution.shortUrl
    });
  } catch (error) {
    return next(error);
  }
});
