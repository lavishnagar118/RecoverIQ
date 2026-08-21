# RecoverIQ — Test Plan

## Unit tests
- expected recovery calculation
- policy thresholds
- stopping rules
- state transitions
- idempotency logic

## Integration tests
- create recovery case
- select action
- approval flow
- webhook processing
- duplicate webhook
- invalid webhook signature
- payment success transition
- payment failure transition

## Failure scenarios
- Razorpay API timeout
- duplicate webhook
- invalid signature
- already-paid case receives another event
- attempt limit exceeded
- case expired
- customer opts out
- policy rejects action

## Evaluation
Run the synthetic batch and record:
- cases
- amount at risk
- recovered amount
- recovery rate
- stopped cases
- escalated cases
- unresolved cases
