# RecoverIQ

AI Revenue Recovery orchestration system for the Razorpay Buildathon - Track 3: AI Revenue Recovery.

## Current Status
Milestone 1: Development foundation.

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

Tailwind CSS, Razorpay integration, AI tooling, recovery logic, policy logic, and production authentication are intentionally not implemented in Milestone 1.

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

Build all applications:

```powershell
npm run build
```
