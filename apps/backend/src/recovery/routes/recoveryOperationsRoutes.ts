import { Router } from "express";

import { getRecoveryRuntime } from "../execution/recoveryRuntime.js";
import { isRecoveryStatus } from "../domain/recoveryState.js";
import { recoveryScenarioTypes, type RecoveryScenarioType, type RecoveryStatus } from "../domain/recoveryCase.js";
import { RecoveryOperationsService } from "../services/recoveryOperationsService.js";
import { assistantRequestSchema, ConversationalAssistant } from "../../ai/conversation/conversationalAssistant.js";
import { recoveryActions, type RecoveryAction } from "../actions/recoveryActions.js";

const parseLimit = (value: unknown, fallback: number, maximum: number): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error("limit must be a single integer query parameter");
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new Error(`limit must be an integer between 1 and ${maximum}`);
  }
  return limit;
};

const buildService = async (): Promise<RecoveryOperationsService> => {
  const runtime = await getRecoveryRuntime();
  return new RecoveryOperationsService(runtime.cases, runtime.executions, runtime.audit, undefined, runtime.dataSource);
};

const buildAssistant = async (): Promise<ConversationalAssistant> => {
  const runtime = await getRecoveryRuntime();
  return new ConversationalAssistant(runtime.cases, runtime.executions, runtime.audit, runtime.execution);
};

export const recoveryOperationsRouter = Router();

recoveryOperationsRouter.get("/dashboard", async (_req, res, next) => {
  try {
    res.status(200).json(await (await buildService()).getDashboard());
  } catch (error) {
    next(error);
  }
});

recoveryOperationsRouter.get("/cases", async (req, res, next) => {
  try {
    const status = req.query.status;
    const scenarioType = req.query.scenarioType;
    if (status !== undefined && (typeof status !== "string" || !isRecoveryStatus(status))) {
      return res.status(400).json({ error: { message: "Invalid recovery status filter", statusCode: 400 } });
    }
    if (scenarioType !== undefined && (typeof scenarioType !== "string" || !recoveryScenarioTypes.includes(scenarioType as RecoveryScenarioType))) {
      return res.status(400).json({ error: { message: "Invalid recovery scenario filter", statusCode: 400 } });
    }
    const limit = parseLimit(req.query.limit, 100, 100);
    const cases = await (await buildService()).listCases({
      status: status as RecoveryStatus | undefined,
      scenarioType: scenarioType as RecoveryScenarioType | undefined,
      limit
    });
    return res.status(200).json({ datasetType: "real_demo", cases, total: cases.length });
  } catch (error) {
    return next(error);
  }
});

recoveryOperationsRouter.get("/cases/:caseId", async (req, res, next) => {
  try {
    const detail = await (await buildService()).getCaseDetail(req.params.caseId);
    if (!detail) return res.status(404).json({ error: { message: "Recovery case was not found", statusCode: 404 } });
    return res.status(200).json(detail);
  } catch (error) {
    return next(error);
  }
});

recoveryOperationsRouter.get("/audit", async (req, res, next) => {
  try {
    const caseId = req.query.caseId;
    if (caseId !== undefined && typeof caseId !== "string") {
      return res.status(400).json({ error: { message: "caseId must be a single query parameter", statusCode: 400 } });
    }
    const limit = parseLimit(req.query.limit, 200, 500);
    const events = await (await buildService()).listAuditEvents(caseId, limit);
    return res.status(200).json({ events, total: events.length });
  } catch (error) {
    return next(error);
  }
});

recoveryOperationsRouter.get("/policy", async (_req, res, next) => {
  try {
    res.status(200).json({ editable: false, policy: (await buildService()).getPolicy() });
  } catch (error) {
    next(error);
  }
});

recoveryOperationsRouter.get("/analytics", async (_req, res, next) => {
  try {
    res.status(200).json(await (await buildService()).getAnalytics());
  } catch (error) {
    next(error);
  }
});

recoveryOperationsRouter.post("/assistant/chat", async (req, res, next) => {
  try {
    const parsed = assistantRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid assistant request", statusCode: 400 } });
    }
    return res.status(200).json(await (await buildAssistant()).respond(parsed.data));
  } catch (error) {
    return next(error);
  }
});

recoveryOperationsRouter.post("/assistant/actions", async (req, res, next) => {
  try {
    if (
      !req.body ||
      typeof req.body !== "object" ||
      typeof req.body.caseId !== "string" ||
      !recoveryActions.includes(req.body.action as RecoveryAction) ||
      req.body.confirmed !== true
    ) {
      return res.status(400).json({ error: { message: "A confirmed valid assistant action is required", statusCode: 400 } });
    }
    return res.status(200).json(await (await buildAssistant()).confirmAction(req.body.caseId, req.body.action));
  } catch (error) {
    return next(error);
  }
});
