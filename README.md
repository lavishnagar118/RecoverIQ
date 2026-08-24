# RecoverIQ

AI Revenue Recovery orchestration system for the Razorpay Buildathon - Track 3: AI Revenue Recovery.

## Current Status
Milestone 5: Razorpay Test Mode `CREATE_PAYMENT_LINK` integration over the deterministic recovery engine.

## Product Goal
Find revenue at risk, diagnose why it is slipping, choose a bounded recovery intervention, execute it through controlled backend tools, and measure the money actually recovered.

## Important
This repository is intentionally a foundation-first starter. Do not ask an AI coding agent to build the entire product in one shot. Work milestone-by-milestone, run tests after each milestone, and commit stable checkpoints.

## Stack
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Database: MongoDB
- Payments: Razorpay Test APIs
- AI: provider-agnostic LLM/tool-calling layer
- Testing: Vitest + Supertest for backend tests

Tailwind CSS, Razorpay integration, payment execution, and production authentication are intentionally not implemented yet. The AI layer is advisory only and cannot execute actions, modify money values, or change recovery state.

## Project Structure

```text
apps/
  backend/   Express API and backend foundation
  frontend/  React dashboard shell
docs/        Product, architecture, decision, and test planning docs
```

## Local Setup

Prerequisites:

- Node.js 20 or newer
- npm
- MongoDB is optional for Milestone 1; the health endpoint does not require a live database connection.

Install dependencies:

```powershell
npm install
```

Create a local environment file:

```powershell
Copy-Item .env.example .env
```

Run the backend API:

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

Synthetic recovery summary:

```powershell
Invoke-RestMethod http://localhost:5000/api/recovery/summary
```

Synthetic recovery cases:

```powershell
Invoke-RestMethod "http://localhost:5000/api/recovery/cases?limit=10"
```

## Local AI configuration

AI advisory mode is disabled by default. Set `AI_ENABLED=true` only when a compatible structured-output HTTP provider is configured by application code. Keep `AI_API_KEY` in the local environment and never commit it. Tests use fake providers and never call a real AI service.

The recovery endpoints use deterministic synthetic data. They do not represent real merchant recovery results.

## Monetary Units

Backend monetary fields are stored as integer INR paise. For example, Rs. 5,000 is represented as `500000`.

## Quality Commands

Backend typecheck:

```powershell
npm run typecheck:backend
```

Backend tests:

```powershell
npm run test:backend
```

Frontend typecheck:

```powershell
npm run typecheck:frontend
```

Frontend build:

```powershell
npm run build:frontend
```

Backend build:

```powershell
npm run build:backend
```

## Razorpay Test Mode demo

Configure only local Test Mode credentials in `.env`:

```text
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
RAZORPAY_API_BASE_URL=https://api.razorpay.com
```

`RAZORPAY_MODE=test` is mandatory. The provider rejects missing or non-test
mode, non-official API hosts, and live-looking credentials. Real Razorpay
execution also requires MongoDB durable storage; the in-memory runtime is only
for deterministic local tests and cannot create external Payment Links.

Execution and case state use conditional transitions and retryable durable
webhook claims. If a provider succeeds but local persistence fails, a later
request or webhook reconciles the stored execution/reference rather than
creating a second link.

The backend selects the action deterministically and exposes:

```text
POST /api/recovery/cases/:caseId/actions
GET  /api/recovery/cases/:caseId
POST /api/webhooks/razorpay
```

Only `CREATE_PAYMENT_LINK` is executable. Payment Link creation is durable when
`MONGODB_URI` is configured, and webhook processing uses the raw request body,
HMAC-SHA256 signatures, and `x-razorpay-event-id` idempotency. Synthetic
evaluation remains in-memory and must not be used to create hundreds of real
Test Mode links.

Build all applications:

```powershell
npm run build
```
