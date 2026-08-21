# RecoverIQ — Product Specification v1.0

## 1. Buildathon track
Razorpay Buildathon — Track 3: AI Revenue Recovery.

## 2. Problem
Merchants lose revenue through failed payments, checkout abandonment, and other payment journey failures. RecoverIQ finds revenue at risk, diagnoses the likely cause, estimates recoverability, chooses an appropriate intervention, executes that intervention within merchant-defined boundaries, and measures the actual money recovered.

## 3. Core scope for V1
Only two scenarios are required:
1. Failed payment recovery.
2. Checkout abandonment recovery.

Do not add subscription recovery, voice recovery, WhatsApp automation, or multi-agent AI until the V1 is stable and tested.

## 4. Core closed-loop workflow
Revenue at risk
-> case creation
-> diagnosis
-> recovery probability
-> expected recovery value
-> intervention selection
-> policy check
-> action execution
-> outcome observation
-> recovered / next action / stop
-> audit trail
-> batch metrics

## 5. Differentiation
The product is not positioned as the first payment-recovery system. Existing platforms already automate recovery.
Our differentiation is:
- decision intelligence rather than simple retry automation
- explicit expected-recovery-value reasoning
- merchant-configurable policies
- bounded interventions
- stopping rules
- transparent audit trail
- batch-level recovery measurement
- honest unsuccessful/unresolved cases

## 6. Decision engine
For each case, calculate:
- amount_at_risk
- recovery_probability
- expected_recovery_value = amount_at_risk * recovery_probability
- estimated_intervention_cost
- action constraints

The first implementation may use deterministic/synthetic scoring rules. The AI layer can explain context, generate messages, and recommend actions, but deterministic backend rules must validate every financial action.

## 7. Example interventions
- payment retry
- recovery payment link
- non-financial reminder/nudge
- merchant approval request

Discounts are optional and must have an explicit merchant-configured maximum.

## 8. Policy examples
- maximum automatic attempts: 3
- maximum automatic recovery amount: configurable
- maximum discount: configurable
- high-value actions require merchant approval
- successful payment closes the case
- customer opt-out closes communication
- low recovery probability can trigger stop
- expired cases stop automatically

Actual values must be configurable, not hard-coded into business logic.

## 9. State machine
AT_RISK
-> ANALYZING
-> ACTION_SELECTED
-> AWAITING_APPROVAL (when required)
-> ACTION_EXECUTED
-> WAITING_RESULT
-> RECOVERED

Failure branch:
ACTION_EXECUTED -> FAILED -> NEXT_ACTION_ELIGIBLE?
YES -> ACTION_SELECTED
NO -> STOPPED

Other terminal states:
EXPIRED
CANCELLED
CUSTOMER_OPTED_OUT

## 10. Audit requirements
Every meaningful financial/recovery action must log:
- case id
- timestamp
- action
- actor (AI/system/merchant)
- reason
- policy decision
- outcome
- related Razorpay identifiers where available
- error information where applicable

## 11. Razorpay integration
Use Razorpay Test Mode for real end-to-end flows.
Planned capabilities:
- Payment Link creation or another suitable test-mode recovery mechanism
- payment status verification
- webhook ingestion
- webhook signature verification
- duplicate-event/idempotency handling

Do not place Razorpay secrets in source control.

## 12. Synthetic evaluation
Create a reproducible synthetic batch for evaluation.
Target: 1,000 recovery cases.

Each case may contain:
- case_id
- customer_id
- amount
- failure_reason
- customer_history
- checkout_status
- previous_attempts
- customer_value
- timestamps
- expected outcome label for simulation

Report:
- total amount at risk
- number of cases evaluated
- number acted on
- number recovered
- amount recovered
- recovery rate
- stopped cases
- escalated cases
- unresolved/unrecovered amount

Synthetic results must be clearly labeled as synthetic/test results.

## 13. Real payment demo
Use a small number of real Razorpay Test Mode cases for the final demo.
Do not depend on hundreds of live test Payment Links for evaluation.

## 14. Frontend requirements
Core views:
1. Executive dashboard
2. Recovery cases
3. Case details
4. Policies/settings
5. Audit trail
6. Analytics

## 15. Quality requirements
- type-safe backend and frontend
- meaningful unit tests
- integration tests for critical API/webhook behavior
- validation at API boundaries
- structured errors
- no secret leakage
- no direct LLM-to-payment execution
- reproducible test data
