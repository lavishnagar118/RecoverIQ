# RecoverIQ Judge Demo Flow

1. Open the dashboard and point out the separate **REAL / DEMO OUTCOMES** and
   **SYNTHETIC EVALUATION** sections.
2. Open `case_20260821_0002` from the dashboard or Recovery Cases.
3. Show the deterministic score, candidate actions, selected action, policy
   decision, and approval requirement.
4. Show the existing Razorpay Test Mode Payment Link evidence and captured
   amount.
5. Explain that the local `RECOVERED` transition came from a locally signed
   webhook simulation. The local payment identifier is intentionally not shown
   as a Razorpay payment ID.
6. Open the audit timeline and show policy approval, Razorpay request,
   Payment Link creation, reconciliation, and recovery success.
7. Open Policies and Analytics to demonstrate bounded controls and the
   distinction between persisted/demo outcomes and synthetic evaluation.
8. Use the failure state component with a genuinely failed or stopped case
   when available. It explains the failure, the safe backend response, whether
   a financial action succeeded, and the next safe state. Do not present
   synthetic or locally simulated failures as real merchant losses.

The dashboard is intentionally read-only. It never automatically triggers a
new Razorpay action.