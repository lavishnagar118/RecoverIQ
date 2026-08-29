# RecoverIQ Operations API

Milestone 6 adds read-only merchant observability endpoints. These endpoints
do not create Payment Links, make payments, or mutate recovery state.

## Operations endpoints

All routes are under `/api/recovery/operations`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/dashboard` | Real/demo persisted metrics plus clearly labeled synthetic evaluation |
| GET | `/cases?status=&scenarioType=&limit=` | Filtered persisted/demo recovery cases |
| GET | `/cases/:caseId` | Case, deterministic decision, policy, execution, payment evidence, and AI advisory |
| GET | `/audit?caseId=&limit=` | Read-only audit events, optionally case-scoped |
| GET | `/policy` | Current deterministic policy; `editable` is currently `false` |
| GET | `/analytics` | Real/demo outcome metrics and synthetic evaluation metrics |

Sensitive credentials, authorization headers, webhook secrets, API keys, and
raw webhook payloads are never returned. Local webhook simulation payment IDs
are not presented as Razorpay-issued payment IDs.

The existing action endpoint remains separate and unchanged:
`POST /api/recovery/cases/:caseId/actions`.