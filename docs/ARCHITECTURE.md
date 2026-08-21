# RecoverIQ — Architecture

## High-level
Frontend (React)
    |
    v
Backend API (Node/Express)
    |
    +--> Recovery domain
    +--> Decision engine
    +--> Policy engine
    +--> Audit engine
    +--> Analytics
    +--> AI tool layer
    +--> Razorpay integration
    |
    v
MongoDB

## AI boundary
LLM
  -> tool request / recommendation
  -> backend schema validation
  -> deterministic policy engine
  -> controlled action service
  -> Razorpay

The LLM must never directly possess or execute payment credentials.

## Suggested backend modules
- recovery
- customers
- transactions
- decisions
- policies
- actions
- payments
- webhooks
- audit
- analytics
- ai

## Important integration rule
Webhook handlers must:
1. validate signature
2. identify event
3. enforce idempotency
4. update state
5. write audit event
6. return an appropriate response
