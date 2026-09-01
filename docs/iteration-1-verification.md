# Iteration 1 — AC verification notes

Checked against `src/**` on 2026-08-30. MSW mocks in `src/mocks/handlers.ts` count as backend where the endpoint + wire exist.

## Result by epic

- **E1 Plant ID & Malaysia status** — 6/6 done.
- **E3 Safe response guidance** — 7/7 done.
- **E4 Reporting & community map** — 8/9 done. 4.1.3 uses `photoKey` upload flow (functionally equivalent to direct image ref).
- **E2 Anonymous access & sighting validation** — partial. Deferred to E2 pipeline redesign.

## Deferred (E2 pipeline)

- 2.1.1 — swap 10-code batch for single ≥128-bit key, or adjust AC wording.
- 2.1.4 — lockout per profileId + IP inside strict 15-min window.
- 2.2.1 — server re-reads scan record to reject mismatched species.
- 2.2.2 / 2.2.3 — field-specific server validation + 422 on unsupported statuses.
- 2.3.1 — image SHA-256 exact-dup detection.
- 2.3.2 — 25 m / 10 min near-dup merge → `merged` status.
- 2.3.3 — 10/token / 30/IP / 10 min rate limit with `Retry-After`.

## Key files touched

- `src/features/scan/ScanResultPage.tsx` (canReport, actionEligible wiring)
- `src/features/scan/PlantGuidancePanel.tsx`
- `src/features/scan/pulih-model.ts`, `malaysia-status.ts`
- `src/features/report/ReportLocationStep.tsx`, `ReportSubmissionResult.tsx`
- `src/features/map/ThreatMapPage.tsx`, `SightingDetailsSheet.tsx`, `MapFilters.tsx`
- `src/mocks/handlers.ts` (species detail, observedAt clamp, sighting statuses)
- `src/services/osm-nearest.ts` (Overpass 5 km lookup)
- `src/data/plant-guidance.*`
