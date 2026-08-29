import type { AssistantActionResult, AssistantMessage, AssistantResponse, AuditEvent, CaseDetail, OperationsCase, Policy, RealSummary, SyntheticSummary } from "../types/operations.js";

const request = async <T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const data = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `Request failed with ${response.status}`);
  return data;
};

export const recoveryApi = {
  dashboard: (baseUrl: string) => request<{ realDemo: RealSummary; syntheticEvaluation: SyntheticSummary }>(baseUrl, "/api/recovery/operations/dashboard"),
  cases: (baseUrl: string, filters: { status?: string; scenarioType?: string } = {}) => {
    const params = new URLSearchParams({ limit: "100" });
    if (filters.status) params.set("status", filters.status);
    if (filters.scenarioType) params.set("scenarioType", filters.scenarioType);
    return request<{ cases: OperationsCase[] }>(baseUrl, `/api/recovery/operations/cases?${params.toString()}`);
  },
  caseDetail: (baseUrl: string, caseId: string) => request<CaseDetail>(baseUrl, `/api/recovery/operations/cases/${encodeURIComponent(caseId)}`),
  audit: (baseUrl: string, caseId?: string) => request<{ events: AuditEvent[] }>(baseUrl, `/api/recovery/operations/audit${caseId ? `?caseId=${encodeURIComponent(caseId)}` : ""}`),
  policy: (baseUrl: string) => request<{ editable: boolean; policy: Policy }>(baseUrl, "/api/recovery/operations/policy"),
  analytics: (baseUrl: string) => request<{ realDemo: RealSummary; syntheticEvaluation: SyntheticSummary }>(baseUrl, "/api/recovery/operations/analytics"),
  assistantChat: (baseUrl: string, caseId: string | undefined, messages: AssistantMessage[]) =>
    request<AssistantResponse>(baseUrl, "/api/recovery/operations/assistant/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(caseId ? { caseId } : {}), messages })
    }),
  assistantAction: (baseUrl: string, caseId: string, action: string) =>
    request<AssistantActionResult>(baseUrl, "/api/recovery/operations/assistant/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId, action, confirmed: true })
    })
};
