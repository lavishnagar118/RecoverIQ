# RecoverIQ

RecoverIQ is a deterministic revenue recovery orchestration prototype built for the Razorpay Buildathon Track 3: AI Revenue Recovery.

This repository models a merchant-facing workflow for identifying at-risk payments, estimating recoverability, selecting a bounded intervention, and enforcing a backend policy gate before any financial action is considered. The implementation is intentionally constrained to a demo and evaluation-grade scope: it is not a production payment system and it does not perform live money movement.

## Why this project exists

Merchants lose revenue when payments fail, checkouts are abandoned, or recovery attempts are not guided by a clear policy. RecoverIQ focuses on the operational decision layer:

- identify the payment or checkout case at risk
- diagnose likely failure reasons
- estimate value and recoverability
- choose a bounded recovery action
- require deterministic backend validation before execution
- record what happened in an auditable trail
- keep synthetic evaluation clearly separated from real Test Mode evidence

## What is implemented

The current implementation includes:

- a deterministic recovery decision engine
- a policy gate that limits allowed actions and stopping conditions
- an AI assistant layer that is advisory only
- a provider-agnostic AI interface with local Ollama support
- Razorpay Test Mode integration for payment-link creation and webhook handling
- read-only merchant operations endpoints for dashboards and audit visibility
- synthetic evaluation data and metrics clearly labeled as synthetic
- a small test/demo flow built around local validation and controlled evidence

## AI Assistant

The AI layer is designed to assist with case understanding and recommendations, not to act as the authority for financial decisions. The backend validates all generated recommendations against backend schemas and merchant policy before allowing an action.

The assistant can:

- read case context and recovery history
- explain likely failure causes
- suggest a recovery action
- surface reasoning and confidence
- produce structured recommendations for the backend to evaluate

The AI layer does not directly execute payment actions, modify money amounts, or change state outside the deterministic validation path.

## Grounded AI

The AI behavior is intentionally grounded in structured data and explicit backend policy. In practice:

- the model receives a structured context payload
- the response must conform to a schema
- the backend validates the response before use
- financial actions are gated by deterministic policy logic
- the final action path remains controlled by the application, not by the model

This keeps the AI layer useful for reasoning and explanation while preserving a deterministic operational boundary around money movement.

## Deterministic policy gate

Every recovery action is checked against explicit backend rules before it can be executed. These checks cover:

- whether the case is eligible for the requested action
- whether the action matches the selected strategy
- whether the attempt count or amount limit is exceeded
- whether the case must stop, escalate, or require approval
- whether the action is allowed under the merchant policy

This ensures the AI can recommend, but the backend decides what is permissible.

## Razorpay Test Mode

The project supports Razorpay Test Mode only. This is a local demo and validation path, not production payment processing.

The backend enforces that:

- `RAZORPAY_MODE` must be set to `test`
- API endpoints must be official Razorpay test endpoints
- non-test or live-looking credentials are rejected
- secrets stay in local environment configuration only

No real payment is executed in this repository outside a local Test Mode flow designed for demonstration and validation. The implementation uses test-mode credentials and isolated webhook/local state handling.

## Webhook verification

Webhook handling is implemented as a backend responsibility with strict validation:

- raw request body is read
- HMAC-SHA256 signature is validated against the configured webhook secret
- event metadata is checked
- duplicate or replayed events are rejected or deduplicated
- the backend updates state only after validation passes

This matters because payment events are operationally sensitive and must not be trusted purely from external payload content.

## Idempotency

The webhook logic includes idempotency checks using Razorpay event identifiers and durable execution references. This prevents repeated processing of the same external event from creating conflicting state changes or duplicate financial actions.

## Reconciliation

If a payment action is initiated and later a webhook or repeated request arrives, the system reconciles the state using persisted execution metadata and the case history instead of blindly creating a second action. This is especially important when the local runtime, provider call, and persisted state can be temporarily out of sync.

## Audit trail

Every meaningful recovery action and webhook outcome is logged to an audit trail. Recorded details include the case, action, time, actor, policy decision, outcome, and relevant payment/webhook identifiers when available.

The audit trail is designed to make the recovery workflow explainable and reviewable without exposing secrets or raw webhook payloads.

## Ollama local AI

Local AI is supported through Ollama. The app defaults to `AI_ENABLED=false`, and if it is enabled the provider is expected to be a local endpoint such as:

- `AI_PROVIDER=http://localhost:11434`
- `AI_MODEL=qwen2.5:3b`

No API key is required for a local Ollama setup. The provider implementation supports a structured response contract and is intentionally isolated from payment execution.

## Repository layout

```text
RecoverIQ/
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   ├── tests/
│   │   └── package.json
│   └── frontend/
│       ├── src/
│       └── package.json
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md
│   ├── RECOVERIQ_SPEC.md
│   ├── API.md
│   ├── DEMO_FLOW.md
│   └── TEST_PLAN.md
└── .github/ (if present)
```

## Local setup

Prerequisites:

- Node.js 20 or newer
- npm
- optional MongoDB for durable persistence in demo/test flows

Install dependencies:

```powershell
npm install
```

Create a local environment file:

```powershell
Copy-Item .env.example .env
```

Run the backend:

```powershell
npm run dev:backend
```

Run the frontend:

```powershell
npm run dev:frontend
```

Backend health check:

```powershell
Invoke-RestMethod http://localhost:5000/api/health
```

Synthetic summary:

```powershell
Invoke-RestMethod http://localhost:5000/api/recovery/summary
```

Sample cases:

```powershell
Invoke-RestMethod "http://localhost:5000/api/recovery/cases?limit=10"
```

Optional local AI setup:

```text
AI_ENABLED=true
AI_PROVIDER=http://localhost:11434
AI_MODEL=qwen2.5:3b
AI_API_KEY=
```

## Demo flow

The demo flow is documented in `docs/DEMO_FLOW.md` and should be followed as written. The implementation distinguishes between:

1. real Razorpay Test Mode payment evidence
2. local signed webhook simulation used to advance a case state locally
3. synthetic evaluation data used for reproducible analysis and metrics

This distinction is important. The dashboard and demo presentation intentionally keep those categories separate and clearly labeled.

## API documentation

The project includes a dedicated API reference in `docs/API.md`.

Key routes:

```text
GET    /api/health
GET    /api/recovery/summary
GET    /api/recovery/cases
GET    /api/recovery/cases/:caseId
POST   /api/recovery/cases/:caseId/actions
POST   /api/webhooks/razorpay
GET    /api/recovery/operations/dashboard
GET    /api/recovery/operations/cases
GET    /api/recovery/operations/cases/:caseId
GET    /api/recovery/operations/audit
GET    /api/recovery/operations/policy
GET    /api/recovery/operations/analytics
```

Only `CREATE_PAYMENT_LINK` is currently supported as an executable action. The action API is separated from the read-only operational endpoints.

## Testing

This repository contains backend tests for deterministic decision logic, policy checks, webhooks, synthetic recovery flows, and AI provider validation.

Run the relevant checks:

```powershell
npm run test:backend
npm run typecheck:backend
npm run typecheck:frontend
npm run build:backend
npm run build:frontend
```

The project also includes a test plan in `docs/TEST_PLAN.md`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Decision log](docs/DECISIONS.md)
- [Product specification](docs/RECOVERIQ_SPEC.md)
- [API reference](docs/API.md)
- [Demo flow](docs/DEMO_FLOW.md)
- [Test plan](docs/TEST_PLAN.md)

## Limitations and scope

This project is intentionally bounded. It does not claim to be a production merchant recovery platform or a live-money system.

Known limitations:

- no live payment execution outside Razorpay Test Mode
- no production auth or merchant identity system
- no full merchant onboarding or billing flows
- AI is advisory and schema-validated, not an authority on money movement
- synthetic evaluation is explicit and labeled, not presented as live recovery
- read-only operations endpoints do not trigger external actions

## Security notes

- keep `.env` local and uncommitted
- never commit real Razorpay keys or webhook secrets
- never expose raw webhook payloads or sensitive credentials in API responses
- keep the AI and recovery policy boundary explicit
- treat all financial transitions as deterministic backend responsibilities

This repository is suitable for local setup, demo presentation, and technical review, but it should not be interpreted as a production-grade payment system.
