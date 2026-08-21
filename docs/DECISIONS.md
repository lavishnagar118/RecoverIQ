# RecoverIQ — Architecture Decisions

## ADR-001: Keep financial execution deterministic
Reason: Money actions must be bounded, testable, and auditable.

## ADR-002: LLM is advisory/orchestration, not the payment authority
Reason: The agent can interpret context and recommend actions, but backend policy must approve execution.

## ADR-003: Evaluate at batch level
Reason: The buildathon explicitly asks for measured money recovered across a batch; one successful example is insufficient.

## ADR-004: Synthetic evaluation + small real Razorpay Test Mode demo
Reason: Synthetic data provides scale and repeatability; real Razorpay Test Mode provides authentic end-to-end integration evidence.

## ADR-005: Build MVP before advanced features
Reason: Reliability and measured outcomes are more valuable than feature count.
