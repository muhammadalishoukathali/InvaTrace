# Iteration 1 — Round 2 check

Re-ran the AC pass after the fixes from round 1. 22 ACs fully implemented, 2 partial, 7 mock-only (all E2 identity/screening endpoints awaiting the pipeline), 0 missing.

## Change from round 1

- **1.2.3** flipped to done — `actionEligible` now flows through `PlantGuidancePanel` and gates `activePathAllowed`.
- Rest held up under an independent re-read.
- E2 rows stay deferred to the pipeline redesign.

## Per-epic

- E1 — 6/6 done.
- E3 — 7/7 done.
- E4 — 8/9 done. 4.1.3 stays partial (mock DB txn only).
- E2 — 1/10 (2.2.2 clamp only). 1 partial, 8 mock-only.
