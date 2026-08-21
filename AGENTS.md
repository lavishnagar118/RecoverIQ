# RecoverIQ — Agent Instructions

## Mission
You are an implementation agent working on RecoverIQ, a Razorpay Buildathon Track 3 submission.

Before changing code:
1. Read `docs/RECOVERIQ_SPEC.md`.
2. Read `docs/ARCHITECTURE.md`.
3. Read `docs/DECISIONS.md`.
4. Inspect the existing repository and follow established conventions.

## Non-negotiable rules
- Do not implement the entire product in one task.
- Modify only files necessary for the requested milestone.
- Do not expose or hard-code secrets.
- Never let an LLM directly execute a money movement/action without a deterministic backend policy check.
- Money calculations, limits, state transitions, webhook verification, idempotency, and Razorpay calls must remain deterministic backend responsibilities.
- Keep financial actions auditable.
- Every recovery action must be bounded by merchant policy and stopping rules.
- Never fabricate production/test results. Metrics must come from executed tests or clearly labeled synthetic data.
- Do not silently swallow errors.
- Prefer explicit failure states and recoverable workflows.
- Add or update tests for every meaningful backend behavior.
- Do not introduce unrelated dependencies or refactor unrelated modules.

## Required workflow
1. Inspect.
2. Explain a concise implementation plan.
3. Implement.
4. Run relevant tests/lint/type checks.
5. Fix failures caused by your changes.
6. Summarize changed files, tests run, and any remaining risk.

## Git safety
- Do not rewrite history.
- Do not amend existing commits unless explicitly requested.
- Never commit `.env` files or secrets.
