import { useEffect, useState } from "react";
import { recoveryApi } from "./api/recoveryApi.js";
import type { AssistantMessage, AssistantResponse, AuditEvent, CaseDetail, OperationsCase, Policy, RealSummary, SyntheticSummary } from "./types/operations.js";

type Page = "Dashboard" | "Recovery Cases" | "Case Detail" | "AI Assistant" | "Policies" | "Audit Trail" | "Analytics";

const navItems: Page[] = ["Dashboard", "Recovery Cases", "AI Assistant", "Policies", "Audit Trail", "Analytics"];
const formatCurrency = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
const readable = (value: string) => value.replaceAll("_", " ");

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function FailureState({ detail }: { detail: CaseDetail }) {
  const execution = detail.latestExecution;
  if (!execution || !["FAILED", "STOPPED"].includes(detail.case.status) && !execution.failureMessage) return null;
  return <section className="failure-card"><p className="eyebrow">Graceful failure state</p><h2>{execution.failureCode ?? "Recovery stopped"}</h2><p><b>What failed:</b> {execution.failureMessage ?? `The case entered ${detail.case.status}.`}</p><p><b>What RecoverIQ did:</b> It retained the audit trail and did not retry outside deterministic policy.</p><p><b>Financial action:</b> {execution.status === "FAILED" ? "No successful financial action is recorded." : "The recorded action remains bounded by policy."}</p><p><b>Next safe state:</b> Merchant review or terminal stop; no automatic external action is pending.</p></section>;
}

function Dashboard({ baseUrl, onCase }: { baseUrl: string; onCase: (id: string) => void }) {
  const [data, setData] = useState<{ realDemo: RealSummary; syntheticEvaluation: SyntheticSummary }>();
  const [cases, setCases] = useState<OperationsCase[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void Promise.all([recoveryApi.dashboard(baseUrl), recoveryApi.cases(baseUrl)]).then(([dashboard, list]) => { setData(dashboard); setCases(list.cases); }).catch((e) => setError(e instanceof Error ? e.message : "Dashboard unavailable")); }, [baseUrl]);
  if (error) return <p className="notice error">{error}</p>;
  if (!data) return <p className="notice">Loading merchant operations.</p>;
  const real = data.realDemo;
  return <><header className="page-header"><div><p className="eyebrow">Merchant operations</p><h1>Revenue recovery command center</h1><p className="subtle">Real/demo outcomes are kept separate from the reproducible synthetic evaluation.</p></div><span className="status-pill">Read-only observability</span></header>
    <section><div className="section-heading"><h2>REAL / DEMO OUTCOMES</h2><span className="data-badge real">Persisted evidence</span></div><div className="metric-grid">
      <Metric label="Amount at risk" value={formatCurrency(real.amountAtRisk)} hint={`${real.totalCases} persisted case${real.totalCases === 1 ? "" : "s"}`} /><Metric label="Expected recovery" value={formatCurrency(real.expectedRecovery)} hint="Deterministic baseline" /><Metric label="Recovered amount" value={formatCurrency(real.recoveredAmount)} hint="Recorded outcomes" /><Metric label="Recovery rate" value={formatPercent(real.recoveryRate)} hint="Recovered cases / cases" /><Metric label="Active cases" value={String(real.activeCases)} hint="Awaiting safe next step" /><Metric label="Stopped / failed" value={`${real.stoppedCases} / ${real.failedCases}`} hint={`${real.escalatedCases} escalated`} />
    </div></section>
    <section className="panel"><div className="section-heading"><h2>Current demonstration cases</h2><span className="data-badge">No external actions</span></div>{cases.length ? <div className="case-list">{cases.map((item) => <button className="case-row" key={item.caseId} onClick={() => onCase(item.caseId)}><span><b>{item.caseId}</b><small>{readable(item.scenarioType)} · {readable(item.status)}</small></span><strong>{formatCurrency(item.amountAtRisk)}</strong></button>)}</div> : <p className="subtle">No persisted/demo cases are available.</p>}</section>
    <section><div className="section-heading"><h2>SYNTHETIC EVALUATION</h2><span className="data-badge synthetic">Synthetic · seed {data.syntheticEvaluation.seed}</span></div><div className="metric-grid"><Metric label="Cases evaluated" value={data.syntheticEvaluation.totalCases.toLocaleString("en-IN")} hint="Reproducible batch" /><Metric label="Synthetic amount at risk" value={formatCurrency(data.syntheticEvaluation.totalAmountAtRisk)} hint="Not merchant revenue" /><Metric label="Expected recovery" value={formatCurrency(data.syntheticEvaluation.totalExpectedRecoveryValue)} hint="Baseline estimate" /><Metric label="Recoverable cases" value={data.syntheticEvaluation.numberOfRecoverableCases.toLocaleString("en-IN")} hint="Threshold-based" /></div></section></>;
}

function CasesPage({ baseUrl, onCase }: { baseUrl: string; onCase: (id: string) => void }) {
  const [cases, setCases] = useState<OperationsCase[]>([]); const [status, setStatus] = useState(""); const [scenario, setScenario] = useState(""); const [error, setError] = useState("");
  useEffect(() => { void recoveryApi.cases(baseUrl, { status, scenarioType: scenario }).then((data) => setCases(data.cases)).catch((e) => setError(e instanceof Error ? e.message : "Cases unavailable")); }, [baseUrl, status, scenario]);
  return <><PageHeader title="Recovery Cases" eyebrow="Operations queue" /><section className="panel"><div className="filters"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{["AT_RISK", "ACTION_SELECTED", "WAITING_RESULT", "RECOVERED", "STOPPED", "FAILED", "AWAITING_APPROVAL"].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select><select value={scenario} onChange={(e) => setScenario(e.target.value)}><option value="">All scenarios</option><option value="PAYMENT_FAILED">Payment failed</option><option value="CHECKOUT_ABANDONED">Checkout abandoned</option></select></div>{error ? <p className="notice error">{error}</p> : <div className="table-wrap"><table><thead><tr><th>Case</th><th>Amount</th><th>Scenario</th><th>Status</th><th>Selected action</th><th>Probability</th><th>Expected net</th><th>Execution</th></tr></thead><tbody>{cases.map((item) => <tr key={item.caseId} onClick={() => onCase(item.caseId)}><td><b>{item.caseId}</b></td><td>{formatCurrency(item.amountAtRisk)}</td><td>{readable(item.scenarioType)}</td><td><span className="status-tag">{readable(item.status)}</span></td><td>{item.selectedAction ? readable(item.selectedAction) : "—"}</td><td>{formatPercent(item.recoveryProbability)}</td><td>{formatCurrency(item.expectedNetRecovery)}</td><td>{item.executionState ? readable(item.executionState) : "—"}</td></tr>)}</tbody></table>{!cases.length ? <p className="subtle">No cases match these filters.</p> : null}</div>}</section></>;
}

function CaseDetailPage({ baseUrl, caseId }: { baseUrl: string; caseId: string }) {
  const [detail, setDetail] = useState<CaseDetail>(); const [events, setEvents] = useState<AuditEvent[]>([]); const [error, setError] = useState("");
  useEffect(() => { void Promise.all([recoveryApi.caseDetail(baseUrl, caseId), recoveryApi.audit(baseUrl, caseId)]).then(([caseDetail, audit]) => { setDetail(caseDetail); setEvents(audit.events); }).catch((e) => setError(e instanceof Error ? e.message : "Case unavailable")); }, [baseUrl, caseId]);
  if (error) return <p className="notice error">{error}</p>; if (!detail) return <p className="notice">Loading case detail.</p>;
  const item = detail.case; const ai = detail.aiAdvisory?.recommendation;
  const selectedAction = item.selectedAction ?? detail.decision?.selectedAction ?? "STOP";
  const policyResult = detail.approvalRequired ? "APPROVAL REQUIRED" : detail.policyDecision === "APPROVED" ? "ALLOWED" : detail.policyDecision;
  const policyConstraint = detail.approvalRequired
    ? `High-value actions require merchant approval at ${formatCurrency(detail.policy.highValueApprovalThresholdPaise)}.`
    : `Automatic recovery is bounded by ${detail.policy.maximumAutomaticAttempts} attempts and a minimum expected net recovery of ${formatCurrency(detail.policy.minimumExpectedNetRecoveryPaise)}.`;
  const hasConflict = detail.aiAdvisory?.validationCode === "CONFLICT" || Boolean(ai?.recommendedAction && ai.recommendedAction !== selectedAction);
  return <><PageHeader title={item.caseId} eyebrow="Recovery case detail" /><div className="detail-grid"><section className="panel"><div className="detail-top"><div><p className="eyebrow">Current status</p><span className="status-tag">{readable(item.status)}</span></div><strong className="hero-amount">{formatCurrency(item.amountAtRisk)}</strong></div><div className="facts"><Fact label="Scenario" value={readable(item.scenarioType)} /><Fact label="Failure reason" value={readable(item.failureReason)} /><Fact label="Checkout" value={readable(item.checkoutStatus)} /><Fact label="Attempts" value={String(item.previousAttempts)} /><Fact label="Recovery probability" value={formatPercent(detail.scoring.recoveryProbability)} /><Fact label="Expected recovery" value={formatCurrency(detail.scoring.expectedRecoveryValue)} /></div><h3>Customer history</h3><p className="subtle">{item.customerHistory.isRepeatCustomer ? "Repeat customer" : "First-time customer"} · {item.customerHistory.successfulPayments} successful · {item.customerHistory.failedPayments} failed · {item.customerHistory.chargebacks} chargebacks · Lifetime value {formatCurrency(item.customerHistory.lifetimeValue)}</p></section>
    <section className="panel policy-panel"><div className="section-heading"><h2>Deterministic Policy Decision</h2><span className="data-badge">Backend policy enforced</span></div><div className="facts"><Fact label="Selected action" value={readable(selectedAction)} /><Fact label="Policy gate result" value={readable(policyResult)} /><Fact label="Relevant policy constraint" value={policyConstraint} /></div><h3>Candidate actions</h3>{detail.decision?.candidates.map((candidate) => <div className="candidate" key={candidate.action}><span>{readable(candidate.action)}<small>{candidate.appropriate ? "Eligible" : "Not eligible"}</small></span><b>{formatCurrency(candidate.expectedNetRecovery)}</b></div>)}</section></div>
    <section className="recovery-flow" aria-label="Recovery decision flow"><div className="flow-step ai-flow-step"><b>AI Advisory</b><span>Diagnosis and recommendation</span></div><span className="flow-arrow" aria-hidden="true">↓</span><div className="flow-step policy-flow-step"><b>Policy Gate</b><span>{readable(policyResult)}</span></div><span className="flow-arrow" aria-hidden="true">↓</span><div className="flow-step action-flow-step"><b>Financial Action</b><span>{readable(selectedAction)}</span></div></section>
    {detail.latestExecution ? <section className="panel"><div className="section-heading"><h2>Execution and payment evidence</h2><span className="data-badge">{readable(detail.latestExecution.status)}</span></div><div className="facts"><Fact label="Execution key" value={detail.latestExecution.executionKey} /><Fact label="Payment Link" value={detail.latestExecution.razorpayPaymentLinkId ?? "Not created"} /><Fact label="Payment Link status" value={detail.latestExecution.paymentLinkStatus ?? "—"} /><Fact label="Captured amount" value={detail.latestExecution.paidAmountPaise ? formatCurrency(detail.latestExecution.paidAmountPaise) : "—"} /></div>{detail.paymentEvidence?.source === "LOCAL_WEBHOOK_SIMULATION" ? <p className="warning">The Payment Link/capture is Razorpay Test Mode evidence; the RECOVERED transition was reconciled by a local signed webhook simulation. The local payment identifier is intentionally not displayed as a Razorpay payment ID.</p> : null}</section> : null}
    <section className="panel ai-panel"><div className="section-heading"><div><h2>🤖 AI Recovery Advisor</h2><p className="subtle">Controlled advisory output for this recovery case</p></div><span className="data-badge">Advisory only</span></div>{ai ? <><div className="ai-status-row"><span className="status-tag">{readable(detail.aiAdvisory?.source ?? "UNKNOWN")}</span><span className="data-badge">{readable(detail.aiAdvisory?.validationCode ?? "UNKNOWN")}</span></div><div className="ai-facts"><div><span>Diagnosis</span><b>{readable(ai.diagnosis.primaryCause)}</b><p>{ai.diagnosis.summary}</p></div><div><span>AI recommendation</span><b>{ai.recommendedAction ? readable(ai.recommendedAction) : "ABSTAINED"}</b><p>{ai.recommendationReason}</p></div><div><span>Confidence</span><b>{formatPercent(ai.confidence)}</b><p>Recovery probability: {formatPercent(detail.scoring.recoveryProbability)}</p></div></div><h3>Key factors / reasoning</h3><div className="chips">{ai.diagnosis.keyFactors.map((factor) => <span key={factor}>{factor}</span>)}</div>{ai.customerMessage ? <><h3>Customer-facing message</h3><p className="customer-message">{ai.customerMessage}</p></> : null}{hasConflict ? <p className="warning"><b>Conflict state:</b> AI recommendation differs from the deterministic selected action. The policy decision remains authoritative.</p> : null}{ai.abstain ? <p className="warning"><b>Abstention:</b> The advisory did not provide an executable recommendation.</p> : null}{[...ai.warnings, ...ai.limitations].map((warning) => <p className="warning" key={warning}>{warning}</p>)}<p className="advisory-disclaimer">AI is advisory only — financial actions are controlled by deterministic policy.</p></> : <p className="subtle">AI advisory was not evaluated for this state.</p>}</section>
    <FailureState detail={detail} /><section className="panel"><div className="section-heading"><h2>Audit timeline</h2><span className="data-badge">Read-only</span></div><AuditList events={events} /></section></>;
}

function AssistantPage({ baseUrl, caseId }: { baseUrl: string; caseId?: string }) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<AssistantResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const suggestions = ["Why hasn't this payment been recovered?", "Analyze this case", "What's the best recovery strategy?", "Recover this payment", "Explain the policy decision", "Show me what happened"];

  const send = async (value = input) => {
    const content = value.trim();
    if (!content || loading) return;
    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setInput("");
    setPending(undefined);
    setError("");
    setLoading(true);
    try {
      const response = await recoveryApi.assistantChat(baseUrl, caseId, nextMessages);
      setMessages([...nextMessages, { role: "assistant", content: response.message }]);
      setPending(response.requiresConfirmation ? response : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assistant unavailable");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!pending?.action || !caseId) return;
    setLoading(true);
    setError("");
    try {
      const result = await recoveryApi.assistantAction(baseUrl, caseId, pending.action);
      setMessages((current) => [...current, { role: "assistant", content: result.message }]);
      setPending(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action could not be completed");
    } finally {
      setLoading(false);
    }
  };

  return <><PageHeader title="🤖 RecoverIQ AI Assistant" eyebrow="Conversational recovery operations" /><section className="assistant-shell panel"><div className="assistant-context"><b>{caseId ? `Case context: ${caseId}` : "No case selected"}</b><span>AI explains and recommends; deterministic policy controls every action.</span></div><div className="assistant-messages">{messages.length ? messages.map((message, index) => <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === "user" ? "You" : "RecoverIQ AI"}</span><p>{message.content.split("\n").map((line, lineIndex) => <span key={lineIndex}>{line}{lineIndex < message.content.split("\n").length - 1 ? <br /> : null}</span>)}</p></article>) : <div className="assistant-empty"><strong>Ask about a recovery case</strong><p>I’ll inspect the selected case, payment state, history, policy constraints, and audit events before answering.</p><div className="suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void send(suggestion)}>{suggestion}</button>)}</div></div>}{loading ? <article className="chat-message assistant thinking"><span>RecoverIQ AI</span><p>Thinking through the available case data…</p></article> : null}</div>{pending?.action ? <div className="assistant-action"><div><b>Confirmation required</b><span>{readable(pending.action)} is ready only after your confirmation. Policy decision: {readable(pending.policyDecision ?? "ALLOWED")}.</span></div><button onClick={() => void confirm()} disabled={loading}>Confirm and proceed</button></div> : null}{error ? <p className="notice error">{error}</p> : null}<form className="assistant-input" onSubmit={(event) => { event.preventDefault(); void send(); }}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask RecoverIQ about this case…" disabled={loading} /><button type="submit" disabled={loading || !input.trim()}>Send</button></form><p className="assistant-disclaimer">AI is advisory only — financial actions are controlled by deterministic policy.</p></section></>;
}

function PoliciesPage({ baseUrl }: { baseUrl: string }) { const [policy, setPolicy] = useState<Policy>(); useEffect(() => { void recoveryApi.policy(baseUrl).then((data) => setPolicy(data.policy)); }, [baseUrl]); return <><PageHeader title="Policies" eyebrow="Deterministic controls" />{policy ? <section className="panel"><p className="subtle">Read-only policy view. Financial actions remain controlled by the backend policy gate.</p><div className="facts"><Fact label="Maximum automatic attempts" value={String(policy.maximumAutomaticAttempts)} /><Fact label="High-value approval threshold" value={formatCurrency(policy.highValueApprovalThresholdPaise)} /><Fact label="Maximum discount" value={formatPercent(policy.maximumDiscountRate)} /><Fact label="Minimum expected net recovery" value={formatCurrency(policy.minimumExpectedNetRecoveryPaise)} /><Fact label="Discounts enabled" value={policy.allowDiscounts ? "Yes" : "No"} /></div><h3>Enabled action costs</h3>{Object.entries(policy.fixedActionCostsPaise).map(([action, cost]) => <div className="candidate" key={action}><span>{readable(action)}</span><b>{formatCurrency(cost)}</b></div>)}</section> : <p className="notice">Loading policy.</p>}</>; }

function AuditPage({ baseUrl }: { baseUrl: string }) { const [events, setEvents] = useState<AuditEvent[]>([]); useEffect(() => { void recoveryApi.audit(baseUrl).then((data) => setEvents(data.events)); }, [baseUrl]); return <><PageHeader title="Audit Trail" eyebrow="Evidence ledger" /><section className="panel"><p className="subtle">Read-only event history. Secrets, authorization headers, webhook secrets, and raw payloads are never returned.</p><AuditList events={events} /></section></>; }

function AnalyticsPage({ baseUrl }: { baseUrl: string }) { const [data, setData] = useState<{ realDemo: RealSummary; syntheticEvaluation: SyntheticSummary }>(); useEffect(() => { void recoveryApi.analytics(baseUrl).then(setData); }, [baseUrl]); if (!data) return <p className="notice">Loading analytics.</p>; return <><PageHeader title="Analytics" eyebrow="Measured recovery" /><section><div className="section-heading"><h2>REAL / DEMO OUTCOMES</h2><span className="data-badge real">Persisted/demo</span></div><div className="metric-grid"><Metric label="Recovered amount" value={formatCurrency(data.realDemo.recoveredAmount)} hint="Observed persisted outcome" /><Metric label="Recovery rate" value={formatPercent(data.realDemo.recoveryRate)} hint="Case-based rate" /><Metric label="Active cases" value={String(data.realDemo.activeCases)} hint="Non-terminal queue" /></div></section><section><div className="section-heading"><h2>SYNTHETIC EVALUATION</h2><span className="data-badge synthetic">Not real revenue</span></div><div className="metric-grid"><Metric label="Cases" value={data.syntheticEvaluation.totalCases.toLocaleString("en-IN")} hint={`Seed ${data.syntheticEvaluation.seed}`} /><Metric label="Amount at risk" value={formatCurrency(data.syntheticEvaluation.totalAmountAtRisk)} hint="Synthetic batch" /><Metric label="Expected recovery" value={formatCurrency(data.syntheticEvaluation.totalExpectedRecoveryValue)} hint="Deterministic estimate" /></div></section></>; }

function AuditList({ events }: { events: AuditEvent[] }) { return <div className="timeline">{events.map((event) => <article key={event.eventId}><span className="timeline-dot" /><div><div className="timeline-head"><b>{readable(event.eventType)}</b><time>{new Date(event.createdAt).toLocaleString("en-IN")}</time></div><p>{event.reason}</p><small>{event.outcome ? `Result: ${event.outcome}` : ""}{event.policyDecision ? ` · Policy: ${event.policyDecision}` : ""}{event.razorpayPaymentLinkId ? ` · Link: ${event.razorpayPaymentLinkId}` : ""}{event.razorpayPaymentId && !event.razorpayPaymentId.startsWith("pay_local_") ? ` · Payment: ${event.razorpayPaymentId}` : ""}</small></div></article>)}</div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="fact"><span>{label}</span><b>{value}</b></div>; }
function PageHeader({ title, eyebrow }: { title: string; eyebrow: string }) { return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div></header>; }

function App() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? ""; const [page, setPage] = useState<Page>("Dashboard"); const [caseId, setCaseId] = useState("case_20260821_0002");
  const openCase = (id: string) => { setCaseId(id); setPage("Case Detail"); };
  const content = page === "Dashboard" ? <Dashboard baseUrl={baseUrl} onCase={openCase} /> : page === "Recovery Cases" ? <CasesPage baseUrl={baseUrl} onCase={openCase} /> : page === "Case Detail" ? <CaseDetailPage baseUrl={baseUrl} caseId={caseId} /> : page === "AI Assistant" ? <AssistantPage baseUrl={baseUrl} caseId={caseId} /> : page === "Policies" ? <PoliciesPage baseUrl={baseUrl} /> : page === "Audit Trail" ? <AuditPage baseUrl={baseUrl} /> : <AnalyticsPage baseUrl={baseUrl} />;
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">R</span><span>RecoverIQ</span></div><p className="sidebar-caption">AI revenue recovery, bounded by policy.</p><nav>{navItems.map((item) => <button className={page === item ? "active" : ""} key={item} onClick={() => setPage(item)}>{item}</button>)}</nav><div className="sidebar-foot">Razorpay Test Mode<br />No automatic actions</div></aside><main className="main-content">{content}</main></div>;
}

export default App;
