# Iteration 2 acceptance verification / 第二轮验收矩阵

Verification date: 2026-09-13
Scope: all 48 criteria from the original Iteration 2 Word document. The plant-classification model, model weights, training data, accuracy, class count, and inference architecture are excluded. Test fixtures prove code paths only and are never counted as production evidence.

Status totals: **PASS 36 / 48**, **BLOCKED 12 / 48**, **NOT SATISFIED 0 / 48**.

| AC | Status | Implementation evidence | Test evidence | External dependency | Notes / 说明 |
|---|---|---|---|---|---|
| 3.3.1 | PASS | `location.py`; `PlantGuidancePanel.tsx`; exact three-state copy and POST contract | `test_iteration2_ac.py`; release-safety E2E | None | API-driven three-state result / 三态结果由 API 驱动。 |
| 3.3.2 | BLOCKED | Protected polygon intersection and fail-closed guidance are implemented | location tests with geometry fixtures | Reviewed protected-area boundary release | No production polygon release is present / 缺正式保护区边界。 |
| 3.3.3 | BLOCKED | Coverage-aware no-intersection path and permission confirmation are implemented | location and action-guidance tests | Boundary and coverage release | A real covered, non-intersecting result cannot be certified yet. |
| 3.3.4 | PASS | Failure, out-of-coverage, and accuracy >250 m all return `boundary_uncertain` and disable action | `test_boundary_failure_is_never_treated_as_outside`; release-safety E2E | None | Failure never defaults to outside / 失败绝不默认区外。 |
| 3.3.5 | PASS | Source, version/update date, API-returned accuracy, and disclaimer are rendered | OpenAPI and UI E2E checks | None | Missing dataset metadata is shown as unavailable, not hardcoded. |
| 4.5.1 | PASS | Public marker and owned-report panels gate `Mark as removed` by current status | happy-path and mock contract tests | None | Rejected, deleted, and already-removed states are excluded. |
| 4.5.2 | PASS | Both entry points request fresh browser geolocation and expose no editable coordinate fields | E2E and source contract tests | Browser geolocation at runtime | Accuracy is shown before submit. |
| 4.5.3 | PASS | `POST /api/v1/reports/{report_id}/removal`; server Haversine validation | exact 250 m and >250 m regression tests | None | Float accuracy is retained without browser rounding. |
| 4.5.4 | PASS | Machine-readable stale/unavailable, inaccurate, and too-far failures precede mutation | GPS boundary tests; full backend suite | None | Rejected requests make no partial update. |
| 4.5.5 | PASS | Append-only `sighting_status_events`; original report/sighting fields remain untouched | preservation and transaction regression test; migration preservation test | None | Stores actor, submitted fix, accuracy, distance, and server time privately. |
| 4.5.6 | PASS | Public response includes removal status/date and excludes private event coordinates/credentials | OpenAPI privacy assertions; E2E marker appearance | None | Original public marker remains with distinct removed styling. |
| 4.5.7 | PASS | Unique event constraint plus existing-event return before GPS revalidation | stale-GPS idempotent retry test | None | No duplicate history event. |
| 5.1.1 | BLOCKED | Stable place API, geometry response, 422 unsupported-geometry path, search/list UI, and OSM importer exist | OpenAPI, unsupported-geometry, and E2E fixture tests | Reviewed Malaysia-clipped OSM place geometry release/import | Mock places do not count as production evidence / mock 地点不算正式数据。 |
| 5.1.2 | BLOCKED | Closed-32, Present, uncertainty, duplicate, bounds, and true country-boundary filtering; processed version stored | occurrence importer and country-coordinate mismatch tests | Reviewed occurrence release and Malaysia boundary GeoJSON | No production occurrence release is present. |
| 5.1.3 | BLOCKED | PostGIS geography implements polygon inside/1,000 m and trail 750 m with distinct evidence types | association unit tests and migration checks | Production place geometry and occurrence releases | Algorithms are ready; real associations cannot be certified. |
| 5.1.4 | BLOCKED | Place-specific directed-network evidence table and fail-closed importer; ≤5 km and water-dispersal gates | trusted-direction, distance, and species tests | Directed OSM waterway preprocessing release | Direction/continuity is never guessed. |
| 5.1.5 | BLOCKED | Explicit ranking components; inside strictly outranks nearby; distance decay; upstream is gated | ranking regression test | Qualifying production occurrence/place/waterway data | UI labels evidence, never probability. |
| 5.1.6 | BLOCKED | Card fields, update date, disclaimer, evidence and canonical catalogue link are implemented | Iteration 2 E2E | Production occurrences plus fully attributed reference images | Current image files are provenance-pending and hidden. |
| 5.1.7 | PASS | Exact no-evidence copy and full-catalogue link | Iteration 2 E2E and mock tests | None | Never claims a place is invasive-free. |
| 5.2.1 | BLOCKED | API and UI return exactly 32 unique stable records with version/review date | shared catalogue, backend, and E2E tests | Fully attributed reference image for every approved plant | No image is presented as approved without full provenance. |
| 5.2.2 | PASS | Trimmed, case-insensitive live search; exact empty copy and clear action | backend test and Iteration 2 E2E | None | No reload required. |
| 5.2.3 | BLOCKED | Detail route supports every required section and honest missing states | catalogue tests and E2E | Missing source-reviewed characteristics, impacts, guidance, and images for part of the 32 | Unreviewed content is not inferred. |
| 5.2.4 | PASS | Exact missing severity and safe-action strings; no model/count inference | backend and E2E assertions | None | Safety fallback is explicit. |
| 5.2.5 | BLOCKED | Manifest schema only approves images with creator, licence, source title, source URL/ID, and review date; pending images are hidden | schema fail-closed test; backend image gate test | Complete image-level provenance for all catalogue images | All 13 inherited files are currently `provenance_pending`. |
| 5.2.6 | PASS | Scanner and place links resolve through the same approved `species_id` records | shared resolution tests and Iteration 2 E2E | Model expansion excluded | Legacy non-approved model classes cannot create business associations. |
| 5.3.1 | PASS | Staging cache, file/asset byte checks, SHA-256 checks, and atomic active-pointer switch | PWA replacement-failure test | None | Failed install preserves the last valid pack. |
| 5.3.2 | BLOCKED | Listing/search/detail/guidance/source data read from the installed cache after offline restart | PWA offline restart test | Approved cached reference images and complete reviewed content for all 32 | Text paths work; all-32 image/content requirement remains blocked. |
| 5.3.3 | PASS | Offline notice shows installed version/review date and separates map connectivity | PWA test | None | Cached catalogue remains accessible. |
| 5.3.4 | PASS | New bundled manifest detection and staging replacement; any failure retains old cache | corrupted same-size asset PWA test | None | Includes same-version download-again failure safety. |
| 5.3.5 | PASS | Version/size and remove/download-again controls; removal targets only the catalogue key/cache | PWA identity-preservation assertions | None | Identity, reports, and adoptions are not cleared. |
| 6.1.1 | PASS | 201 POST contract, confirmation UI, and returned IDs/timestamp | OpenAPI and Iteration 2 E2E | Supported production place required for real use | Code/API criterion is complete. |
| 6.1.2 | PASS | Successful place-linked reports offer an identified adoption prompt; dismiss is local only | happy-path E2E and mock flow | Supported place at report coordinates | Decline does not mutate the report or create adoption. |
| 6.1.3 | PASS | Unique key is `(profile_id, place_id)`, never `place_id` alone | model/migration and ownership tests | None | Different identities may adopt the same place. |
| 6.1.4 | PASS | Advisory idempotency lock and owner/place lookup return existing adoption | backend and mock tests | None | No duplicate row. |
| 6.1.5 | PASS | Owner-scoped DELETE; public reports/place rows are untouched | negative owner test and E2E | None | User A cannot delete user B's bookmark. |
| 6.1.6 | PASS | All adoption surfaces use monitoring-bookmark language and permission disclaimer | E2E and rendered UI review | None | No ownership language. |
| 6.2.1 | PASS | Owner-scoped list includes place, type, adoption date, and latest report | backend and Iteration 2 E2E | None | Each adoption appears once. |
| 6.2.2 | PASS | Server-clock metrics exclude inactive statuses and count distinct `species_id` | frozen-clock boundary tests | None | Uses half-open latest-30-day window. |
| 6.2.3 | PASS | Stored geometry snapshot/version; polygon membership and exact 750 m trail rule | geometry-expression and mock-scope tests | None | List and activity map share the rule. |
| 6.2.4 | PASS | Exact `Community monitoring activity`; no combined score | UI and API contract tests | None | No ecological-health inference. |
| 6.2.5 | PASS | Server name/recent sorting; no-report places last; activity navigation | Iteration 2 E2E | None | Recent uses latest qualifying report descending. |
| 6.2.6 | PASS | Zero-item state with Browse places and no synthetic KPI/report | rendered mobile review and E2E | None | Empty means empty. |
| 6.3.1 | PASS | Owner-scoped activity endpoint uses stored geometry and returns version/map extent | ownership and geometry tests; E2E | None | Trail map geometry is the stored snapshot buffered 750 m. |
| 6.3.2 | PASS | Marker detail exposes required labels/dates/status; removal markers remain distinct | UI E2E and OpenAPI assertions | None | Private raw removal fix is not returned. |
| 6.3.3 | PASS | Plant/status/period filters are server-applied before markers, counts, comparison, and concentration | Iteration 2 E2E and mock tests | None | Clear filters restores the full qualifying set. |
| 6.3.4 | PASS | Latest-30-day active-only complete-link groups require every pair ≤250 m | chain A-B-C regression test | None | No single-link overstatement and no abundance language. |
| 6.3.5 | PASS | Server-time `[0,30)` vs `[30,60)` windows, raw counts and direction | 29/30/59/60-day, UTC-midnight, and MY-timezone tests | None | No ecological improvement/deterioration claim. |
| 6.3.6 | PASS | Geometry remains while exact no-report message is returned | API/UI E2E | None | No synthetic markers and no absence inference. |

## External release inputs still required / 尚缺正式发布资料

1. A reviewed protected-area boundary release plus explicit coverage geometry and source/version/update metadata.
2. A reviewed Malaysia-clipped OSM place geometry release (parks, forests, and trails) imported into production.
3. A cleaned occurrence release plus the reviewed Malaysia boundary GeoJSON used by the importer.
4. Directed OSM waterway preprocessing output with network continuity, direction, place/occurrence linkage, and data version.
5. Fully attributed, reviewed local reference images for all 32 plants.
6. Missing source-backed identifying characteristics, impact text, habitat detail, and safety guidance for catalogue entries that currently show honest unavailable states.
