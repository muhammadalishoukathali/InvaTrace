# InvaTrace usability testing — iteration 2 retest

Date: 2026-09-23. Scope: the UT-12 focused retest of the fixes made for the
findings in *InvaTrace Usability Testing Findings Iteration 2*. Verified against
a full local stack (`docker compose --profile demo up`: API + PostgreSQL/PostGIS
+ Redis + MinIO + screening worker + demo dataset) with the frontend on
`http://localhost:5173`.

## How each finding was verified

| ID | Finding | Fix | Verification | Result |
|----|---------|-----|--------------|--------|
| UT-01 | Plant analysis unreliable | (fixed before this round) | n/a | Pre-existing |
| UT-02 | Camera capture | Failed-camera now offers a gallery exit; larger previews | Live — camera-error state shows "Use device camera app" **and** "Choose from library" | ✅ |
| UT-03 | Safety guidance too dense | Action headline first; passive detail collapsed into disclosures; safety gates stay inline | Live — sighting → Identification & safety shows "Check before acting" banner first, then collapsible "About this plant" / "Check the match" / "Things to watch for"; a disclosure expands on click | ✅ |
| UT-04 | Recovery setup friction | "Why this matters" explainer above the codes | Live — new-profile onboarding shows the explainer (no email/phone; codes only for device move/restore) above the code grid | ✅ |
| UT-05 | Monitoring language unclear | "Approved plants/species" → "Supported invasive plants"; plain adopt copy | Live — monitoring-area metric reads "Supported invasive plants"; activity filter reads "All supported invasive plants"; adopt notice states non-exclusive, no removal permission | ✅ |
| UT-06 | Lost context between screens | Shared back link on detail screens; catalogue → places link | Live — "Back to places" / "Back to monitoring areas" render; catalogue entry links to Browse places | ✅ |
| UT-07 | Visual comparison incomplete | Honest empty state when a native look-alike has no reviewed image | Unit test (needs a scan result to view live) | ✅ code; images still to source |
| UT-08 | Place markers / empty map | Keyless OpenFreeMap vector basemap across all map screens; explicit empty-view message | Live — basemap renders; park/forest place markers and sighting pins visible; place boundary map renders on place detail | ✅ |
| UT-09 | Records recovery paths | Common + scientific names, location label, newest-first | Unit tests on the name/location helpers; the same name-pairing + place-label pattern is visible in the map reports list | ✅ |
| UT-10 | Report correction/withdrawal | Withdrawal for a published report; sighting leaves the public map, report + audit kept | **Live end-to-end integration test** against the real stack: publish → withdraw → sighting drops from `/sightings` → report retained in `/reports/mine` → idempotent | ✅ |
| UT-11 | Offline catalogue install | (fixed before this round) | n/a | Pre-existing |
| UT-12 | Focused retest | this document | Live journeys + integration suite | ✅ |
| UT-13 | Reports list not discoverable | Screen-reader-only list made a visible collapsible panel | Live — "Community reports · 13" panel visible below the map, populated with real reports | ✅ |

## Live integration journeys (real stack)

`RUN_INVATRACE_INTEGRATION=1 pytest backend/tests/integration/test_full_stack.py`
— **5 passed**:

- private access + automated validation end to end
- scan → report → publish sighting end to end
- **report withdrawal hides the sighting but keeps the report** (UT-10)
- report cannot swap species/confidence from the scan
- saved installation bootstraps without a recovery prompt

## Frontend checks

`npm run lint`, `npm run typecheck`, `npm run test` — all green (frontend unit
suite, including the iteration-2 usability guards).

## Remaining, out of code scope

- **UT-07 images** — sourcing licensed reviewed look-alike photos and populating
  each species' `nativeTwin` is a content/licensing pass; the UI handles the
  missing-image case honestly in the meantime.
