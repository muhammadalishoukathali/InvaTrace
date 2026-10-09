# Iteration 3: local implementation and verification

Epic 9 community events and Epic 4 follow-ups use the attached plan’s 48 acceptance criteria. The implementation was prepared on `feature/iteration-3`, based on main `d89d9ae2f76060e180369e06e333078e5f54bf1b`. This document records local acceptance verification before release. Production verification is a separate release step.

## Run locally

Use a **separate local PostGIS database**, never the Render database. The current local database is `invatrace_it3` at `127.0.0.1:55432`. The existing local container is `invatrace-it3-postgis`; it uses `postgis/postgis:17-3.5` with the amd64 platform on this Mac. Local database credentials are development-only.

From the repository root, activate `.venv` or prefix Python commands with `.venv/bin/`. Set `DATABASE_URL` to that local database connection, then:

```sh
(cd backend && ../.venv/bin/alembic upgrade head)
.venv/bin/invatrace load-reference-data
.venv/bin/invatrace seed-acceptance-demo
```

Start the API:

```sh
RATE_LIMIT_ENABLED=false CORS_ORIGINS=http://localhost:5173,http://localhost:5175 \
  .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8800
```

Start the web app in another terminal:

```sh
VITE_ENABLE_MOCKS=false VITE_API_BASE_URL=http://localhost:8800 npm run dev -- --port 5173
```

Open `/events`, start private access, and acknowledge the recovery kit. Discovery links to hosting and hosted-event management; monitoring-area and place pages link to events scoped to that place. The local seed contains two published events, one completed event with three screened reports, and one sighting in each follow-up state. These are explicitly labelled demo records. Existing seed records are preserved on repeated seeding; their dates do not roll forward automatically.

Lifecycle jobs run every five minutes (completion) and one hour (automatic cancellation) when `RUN_WORKERS_IN_API=true`. Enable this only against an isolated database. Defaults: host cap 3, flag threshold 3 identities, report budget 60 per identity/event, check-in grace 30 minutes before start, hidden inactivity 14 days. Settings are `EVENT_HOST_CAP`, `EVENT_FLAG_HIDE_THRESHOLD`, `EVENT_REPORT_BUDGET_PER_IDENTITY`, `EVENT_CHECKIN_GRACE_MINUTES`, `EVENT_HIDDEN_AUTO_CANCEL_DAYS`.

## Acceptance coverage

Each row is implemented. Verification combines focused unit tests, real PostGIS endpoint tests, browser flows and desktop/mobile inspection; it does not claim a separate automated test for every visual or wording criterion.

Test keys:

- **API**: `backend/tests/integration/test_iteration3_postgis.py` and `test_iteration3_edges_postgis.py`.
- **Summary**: `backend/tests/integration/test_iteration3_summary_postgis.py`.
- **Report**: `backend/tests/test_events_reports.py`, `backend/tests/integration/test_iteration3_reports_postgis.py`, `src/features/report/event-report-queue.test.ts`, `e2e/report-event.spec.ts`.
- **Lifecycle**: `backend/tests/integration/test_iteration3_lifecycle_postgis.py`.
- **Follow-up**: `backend/tests/test_follow_up.py`, `backend/tests/integration/test_iteration3_followup_postgis.py`, mock-handler tests and `e2e/follow-up-outcomes.spec.ts`.
- **Browser**: `e2e/events.spec.ts`, `e2e/events-audit.spec.ts`, `e2e/iteration3-audit.spec.ts` and `src/services/api/events.test.ts`.
- **Visual**: desktop (1440px) and mobile (390px) inspection of discovery, detail, safety dialog, hosted-event management, every host step, summary, check-in, follow-up selection/confirmation/errors and needed-sighting detail. No horizontal page overflow or uncaught JavaScript errors; long-title and dialog-focus assertions are automated.

| Criterion | Implemented behavior | Verification |
|---|---|---|
| 9.1.1 | Discovery includes visible published events whose end is in the future | API, Summary |
| 9.1.2 | Place-anchored meeting markers and place-scoped endpoint | API, Summary, Browser |
| 9.1.3 | Type and host display labels | API, Browser, Visual |
| 9.1.4 | Map and accessible list share the same species/date/viewport query | Browser, Visual |
| 9.1.5 | Honest empty, loading, error and retry states | Browser |
| 9.1.6 | Events links from adopted areas, scoped by place ID | Summary, Visual |
| 9.2.1 | Detail shows purpose, species, meeting point, local times and safety | Browser, Visual |
| 9.2.2 | Join uses the current pseudonymous identity | API, Browser |
| 9.2.3 | Unique, idempotent participation; withdrawal and rejoin | API, Browser |
| 9.2.4 | Joining does not grant removal permission; confirmation can be declined without joining | Browser, Visual |
| 9.2.5 | Public response has aggregate counts, no participant list or private identity | API, Summary |
| 9.2.6 | HTTPS chat links appear only for the host or joined participant, while visible and uncancelled | Summary, request-contract tests |
| 9.3.1 | Check-in uses fresh device geolocation without editable coordinate fields | Browser, Visual |
| 9.3.2 | Server validates status, time, accuracy, current geometry and membership; successful check-in auto-joins | API |
| 9.3.3 | Specific rejection codes and no partial participation/check-in writes | API |
| 9.3.4 | Checked-in workspace uses activity-specific guidance and explicit scan action | Browser, Visual |
| 9.4.1 | Classifying a scan does not create a report | Report browser flow |
| 9.4.2 | Explicit event submission persists event ID and capture timestamp | Report |
| 9.4.3 | Spatial near-duplicate merges remain within one identity; exact/perceptual evidence checks remain unchanged | Existing near-duplicate/screening tests |
| 9.4.4 | Event-linked records have a community-reported label | Report contract, records/tracking UI |
| 9.4.5 | Event state, check-in, location, capture window and +24h upload grace are enforced; rejected scans remain locally usable, including explicit ordinary recovery after an offline event rejection | Report, Browser |
| 9.4.6 | Per-event/identity report budget returns a permanent rejection, preserving photo | Report |
| 9.5.1 | Summary counts only screened, event-tagged reports captured in-window; counts distinct species | Summary |
| 9.5.2 | Summary uses factual community-monitoring language without treatment/health scores | Summary, Visual |
| 9.5.3 | Summary follows the mapped place using the existing adopted-area API and refreshes the monitoring-area cache | Visual, existing adopted-area tests |
| 9.5.4 | Summary links the earliest future visible published event at the same place | Summary |
| 9.6.1 | Host ownership for create/edit/cancel; six activity-sensitive fields locked | API |
| 9.6.2 | Display name or “Community host”; private public_id is never a fallback | API |
| 9.6.3 | Required fields, aware ordered times, valid mapped place and meeting geometry validated; each form step prevents invalid advancement | API, Browser, Visual |
| 9.6.4 | Drafts are private and absent from discovery; publication revalidates geometry | API |
| 9.6.5 | Permission context required and safety notes shown | Request-contract tests, Visual |
| 9.6.6 | Activity type required; removal requires explicit permission in both form and server | Request-contract tests, Visual |
| 9.7.1 | Cancellation is soft and idempotent, preserves attendance/report history and cannot cancel a completed summary | Summary, Lifecycle |
| 9.7.2 | Profile lock serializes cap checks; fourth active hosted event rejected | API |
| 9.7.3 | One flag per distinct non-host identity; third hides; only restoring a hidden event clears flags | API |
| 9.7.4 | Idempotent completion job emits audit records | Lifecycle |
| 9.7.5 | Hidden, inactive published events auto-cancel after 14 days; host management explains review/restore; automatic cancellation can be restored after publish validation | Lifecycle |
| 4.6.1 | Removal-reported sightings have a grey marker and follow-up-needed label; the legend names the grey states (follow-up needed, resolved after follow-up) | Follow-up, map implementation, Visual |
| 4.6.2 | Start-follow-up action appears for needed state | Follow-up UI |
| 4.6.3 | Explicit needed-state map filter | Follow-up |
| 4.7.1 | Fresh GPS, accuracy ≤250m and distance ≤250m gates | Follow-up |
| 4.7.2 | Three explicitly selectable outcomes | Follow-up |
| 4.7.3 | Review and success describe the resulting state | Follow-up browser |
| 4.7.4 | Location, freshness, accuracy and distance failures show recovery guidance and clear rejected fixes; concurrent state changes return to the map | Follow-up, Browser |
| 4.8.1 | No regrowth resolves the sighting, hiding it from default map and retaining explicit resolved lookup | Follow-up |
| 4.8.2 | Regrowth returns an active coloured sighting with dated badge | Follow-up |
| 4.8.3 | Unable-to-confirm keeps grey/needed state and records latest attempt date | Follow-up |
| 4.8.4 | Chronological append-only history exposes type/date with a stable tie-breaker, keeping exact follow-up coordinates private | Follow-up |
| 4.8.5 | Regrowth makes the sighting active again and a signed-in user can mark it as removed again (same fresh-GPS rules as the first removal), which restarts the follow-up cycle with a new dated removal and follow-up needed state | Follow-up, Browser, real-stack e2e (`e2e/real-removal-cycle.spec.ts`) |

## Verification commands

```sh
.venv/bin/ruff check backend/app backend/tests
.venv/bin/pytest backend/tests -q
npm run lint
npm run test
npm run build
npm run test:e2e
```

The default browser suite uses MSW. Stop any real-API Vite server on 5173 before running it, because the existing config reuses that port. The new event browser tests are deliberately gated. With the local API running on 8800 and port 5175 free:

```sh
PLAYWRIGHT_EPIC9=1 npx playwright test --config=playwright.it3.config.ts
RUN_INVATRACE_IT3_POSTGIS=1 .venv/bin/pytest backend/tests/integration/test_iteration3* -q
```

Set the local `DATABASE_URL` for the second command. PostGIS tests use real geometry and persisted endpoint state; object storage is mocked for report tests. Browser tests combine actual private-access setup with deterministic event/report boundaries and one real seeded follow-up through the local API. A separate PostGIS concurrency test verifies that simultaneous terminal follow-ups save exactly one outcome. Repeated unable attempts remain allowed by the specification. Real production object storage and device GPS were not tested; browser GPS is controlled. Existing test skips remain intentional integration/model gates.

Current audit results: backend unit suite **291 passed / 9 skipped**, dedicated PostGIS integration **7 passed**, frontend unit suite **232 passed**, standard browser regression suite **21 passed** (intentional integration gates skipped), iteration-3 browser checks **22 passed** (21 in the full gated run plus the final auto-join regression; affected check-in tests rerun). Ruff, ESLint, TypeScript and production build passed.


## Corrections from the acceptance audit

All corrections remain within the existing 48 criteria:

- Safety flags cannot be erased by restoring a still-visible event. Completed events retain their summaries; repeated cancellation emits one audit event. Cancel and withdrawal use the specified write limiter. Host management offers restoration only where the server permits it, including automatic cancellations.
- Hosting validates required fields, coordinates, ordered times, removal permission and HTTPS chat links at the relevant step. Non-host editing is blocked, query refetches preserve unsaved edits, and place-loading failures offer retry.
- GPS refresh clears the previous fix and error. Late callbacks cannot overwrite a newer request or a different sighting. Back preserves the selected follow-up outcome, but rejected GPS cannot be reused. Concurrent state changes explain why a location retry will not help.
- The event safety dialog appears above mobile navigation, traps focus, makes the background inert, and restores focus on close. Long text wraps and event management controls retain usable touch targets.
- Discovery includes host labels, validates date-range order and communicates filter refresh. Event management, successful check-in auto-join and summary follow actions refresh their dependent caches. Invalid meeting coordinates and map-load failures retain readable guidance.
- Offline event rejections retain the photo and offer an explicitly confirmed ordinary submission. Unrelated report-validation failures keep their original error and event state; they do not claim that ordinary submission would solve the problem.
- Follow-up history uses a deterministic date/ID order; outcome success text describes the state already recorded.

Local screenshots are in `verification/audit-*.png` and `verification/audit-confirm-*.png`; that directory is ignored by Git. The audit found no remaining acceptance mismatches in the tested scope. Browser-controlled GPS and mocked object storage do not prove real-device GPS or production storage behavior.

## Compatibility and migration notes

- Event-less report serialization and idempotency digests preserve their existing shape. Sighting response changes are additive. Exact-image evidence cannot be silently attributed to a different event: the API returns `409 event_report_already_linked`, and the UI preserves the scan.
- The repository’s actual mapped places are a union of `monitored_areas` and `trails`, not `monitored_places`. Event writes resolve that union and snapshot its geometry version. Polygon membership uses PostGIS covers; trails use a 750m buffer. Target species use the existing JSON/JSONB database convention.
- The three additive revisions are `20261002_21_events_core`, `20261002_22_reports_event_id`, `20261002_23_follow_up`, following the existing revision 20. Fresh local upgrade → downgrade three revisions → upgrade was verified. Revision 23 refuses to erase populated follow-up history on downgrade; preserve/export such data before a deliberately planned rollback.
- Broad `alembic check` currently reports pre-existing extension-owned tiger/topology tables and existing place-evidence index/constraint drift. That check is not reported as passing. The explicit migration round-trip and new PostGIS endpoint tests pass.
- Runtime-asset import warnings from the existing Vite setup and the pre-existing npm audit findings remain outside this iteration’s changes.

## Real-stack check for AC 4.8.5

The removal-after-regrowth cycle also runs against the real API and PostGIS (no mock service worker) with browser GPS emulated locally:

```bash
docker compose --profile demo up -d --build api worker seed-demo
REAL_API_URL=http://127.0.0.1:8000 npx playwright test -c playwright.real.config.ts e2e/real-removal-cycle.spec.ts
```

The demo seed has one active linked sighting, so use `docker compose down -v` before repeating. Restoring the old `uq_sighting_removal_event` unique index makes this test fail, which confirms migration `20261009_25` is what enables the second removal. Production keeps the 350 m location gate; the live check is a manual on-site step.
