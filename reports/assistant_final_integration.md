# Final Plant Assistant integration review — 8 October 2026

Latest update: the **9 October acceptance confirmation** section at the end
records Zack's confirmation of the General Knowledge AC exceptions, Map/Guide
entrypoint criteria and completed General Knowledge real-answer human review.
It supersedes earlier pending statements for those decisions. The **9 October
Event fixture correction** supersedes the original three Event failures and the
23-file candidate count. Earlier test runs and scope counts remain historical.

The local implementation is complete for review: Scan Result, Map and Plant Guide
reuse one assistant UI and botanical backend. General Knowledge supports Simpler
and Standard only; its Detailed restriction is enforced in the backend. Grounded
RAG retains all three depths, safety rules, citations and final grounding.
The scoped AC decisions and General factual human review are now confirmed by
Zack, as recorded below. Current Git publication preflight and explicit Git-action
authorisation remain outstanding. The initial integration used no real inference;
the separately authorised later six-request key validation remains distinct.
No staging, commit, push, PR, merge, deployment, LeanKit write or team-main change
was performed.

## Verified authority and preservation

- Authoritative repository: `muhammadalishoukathali/InvaTrace`.
- Read-only remote URL: `https://github.com/muhammadalishoukathali/InvaTrace.git`.
- Verified branch: `main`.
- Latest baseline: `f65a68990a5d6c7d0faed9d2e7ca6b281c091957`,
  2026-10-08 16:32:01 +08, merge of PR 58 (`fix/cors-put-and-mission-dock`).
- Latest changed paths versus its first parent: `backend/app/main.py`,
  `backend/tests/test_cors_preflight.py`, `src/features/map/map-controls.css`.
  All three are unchanged in this candidate. Final read-only remote verification
  still returned the same SHA.
- New isolated worktree: `/Users/zack/workspace/FIT5120-3/InvaTrace-botany-final`.
- New branch: `feat/general-botany-release`; HEAD is still the baseline, with no
  candidate commit. The configured `origin` inherited from the parent checkout is
  Zack's `InvaTrace-RAG`, not the authoritative team repository. No remote setting
  was changed; publication target must be checked in any later authorised task.
- Downloads inspection found no newer authoritative Ali project archive. The
  available InvaTrace archives are older September copies and were not used to
  overwrite Git. The latest verified requirements document is the full Iteration 3
  update dated 2026-10-08, not the older standalone Epic 8 v2 DOCX.
- The original General Knowledge candidate has the **same** baseline SHA, so no
  base delta had to be reconciled. Ali's newer unrelated features were retained.
- Original main, General Knowledge, publication and Epic 8 checkouts retain their
  original HEAD, branch, dirty/untracked status, dirty-file hashes and index state.
  Local test services were stopped; dedicated test data was retained. No cleanup,
  reset, stash or deletion was performed.

## Reused changes (exactly 11 existing candidates)

The following existing changes were imported from
`InvaTrace-assistant-general-knowledge` and adapted only where the final scope or
safe entrypoint contracts required it:

```text
backend/app/api/routers/plant_assistant.py
backend/app/domain/assistant_general_knowledge.py
backend/app/services/assistant_general_knowledge.py
backend/app/services/assistant_judge.py
backend/app/services/assistant_provider.py
backend/tests/test_assistant_general_knowledge.py
backend/tests/fixtures/assistant_general_captured_outputs.json
src/features/scan/PlantAssistantPanel.tsx
scripts/check-epic8-local-ui.mjs
scripts/check-epic8-live-ui.mjs
docs/assistant-general-knowledge.md
```

The live script was syntax checked only, never executed. The captured-output JSON
is a curated, pre-existing negative/validation regression fixture, not approved
runtime botanical knowledge. Raw local provider response ledgers remain excluded.

## Final architecture and limitations

| Context | Backend contract | Trusted reference and limitation |
|---|---|---|
| Scan Result | Existing `/api/v1/plant-assistant/ask`, genuine species/outcome/confidence | Existing confidence and supported-category gate retained; Map/Guide never manufacture scan fields |
| Map | `/api/v1/plant-assistant/map/ask`, UUID `sightingId`, question/depth/optional capability | Backend selects only species ID/Latin name for a genuine currently public sighting; requires consistent approved mapping |
| Plant Guide | `/api/v1/plant-assistant/guide/ask`, exact `speciesId`, question/depth/optional capability | Trusted bundled guide catalogue maps to backend approved reference; this is education, not an observed-plant identification |

Map accepts `screened`, `removal_reported` and `resolved_after_follow_up`, matching
existing public record visibility. Candidate/private/withdrawn/unknown/mismatched
records cannot supply assistant context. It does not query report data, user data
or coordinates. The client lookup is only for presentation; the backend rechecks
public visibility and species mapping on every question.

The actual Map route is `/map`, using `ThreatMapPage`, MapLibre and the existing
selection store. A visible button and an optional public-details-sheet button open
`MapPlantAssistant`; the existing details modal is temporarily unmounted to avoid
competing focus traps. Closing restores the original selected-record UI. The map,
location features, saved private record sheet, filters and controls remain intact.
Without a selection, verified deterministic help is available; **no-selection
conversational generation is not included**.

The actual Plant Guide route is `/catalogue/:speciesId`. Its existing detail page
opens `GuidePlantAssistant` without changing guide content. Both wrappers reuse
`PlantAssistantPanel` and the same backend `answer_for_species` pipeline; no separate
chatbot, navigation engine, model or knowledge pack was introduced. Scan retains
its existing inline instance and genuine result context. Marker/guide changes and
modal reopen remount the appropriate component; Map keys also include its approved
species reference so an updated mapping cannot reuse an incompatible conversation.

Routing remains LOCKED -> supported GROUNDED -> strictly eligible GENERAL_KNOWLEDGE.
Whole-question concept eligibility, privacy and existing safety checks are required.
Ordinary evidence gaps may allow general education; malformed, incomplete and
uncertain semantic verdicts cannot. General output is labelled, makes no species
claim and returns empty sources; it is not presented as source verified.

| Lane | Simpler | Standard | Detailed |
|---|---|---|---|
| Grounded | Available | Available | Available |
| General Knowledge | Available | Available | Backend/service refusal, no generation or silent downgrade |

A general-shaped Detailed question that still needs semantic review receives an
honest evidence-check limitation with no provider request; it is not falsely marked
as a verified gap. Demonstrably supported Grounded Detailed remains available.
This conservative unresolved case is a documented limitation of the release.
General repeats offer Simpler/Standard; grounded repeats retain Simpler/More detail.
Older Scan requests without `allowGeneralKnowledge` remain source-only, and
`answerMode` is additive. Event policies, shared permissions, classifier behavior,
reviewed knowledge content and unresolved class 23 mapping were not changed.

Gemini remains primary. The existing eligible-failure set and bounded deadline may
route to configured zero-cost Groq; valid unsupported/uncertain verdicts, rejected
answers and failed grounding never request another provider opinion. Both-provider
failure preserves supported retrieved-source fallback; a General request with no
sources gives an honest unavailable response. Models/configuration/credentials and
billing were not changed. No web search or production source fetching was added.

## Actual regression results — initial 8 October run

| Check | Result | Scope / qualification |
|---|---|---|
| Backend | **1,253 PASS / 11 SKIP** | General, shared API, failover, answerability, grounding, citations, locked safety, depth and context tests; gated infrastructure modules are skipped here |
| Frontend | **308 PASS**, 43 files | Full unit suite, including typed Scan/Map/Guide request-envelope test |
| Offline Scan browser/API | **29 groups PASS**, 36 local API posts | Actual Scan Result/shared UI to local API; mocked inference, no live calls |
| Actual three-entrypoint browser/API | **27 groups PASS**, 22 local API posts | Actual AppShell, MapLibre, public details, Plant Guide and Scan UI; M01–M20 + G01–G07, desktop/mobile |
| TypeScript / ESLint | **PASS** | Full checks on integrated frontend/scripts |
| Ruff check | **PASS** | Full backend |
| Ruff format, changed Python files | **PASS**, 8 files | All candidate Python files |
| Ruff format, full backend | **FAIL: 35 baseline files** | Each is unchanged from verified main; do not reformat unrelated code |
| Production build | **PASS** | TypeScript + Vite/PWA + existing asset publication steps, local output only |
| Database migrations | **PASS** | Dedicated isolated database |
| PostGIS | **9 PASS / 3 FAIL** | Includes real public/private Map lookup; failures below |
| Full stack | **5 PASS** | Isolated API/Redis/PostGIS/S3-compatible storage/workers, providers disabled |

Skipped tests are not counted as PASS. Backend was initially invoked from the
repository root and failed import collection; it was rerun from `backend`, the
correct project working directory, with the above result. Browser harness setup
issues were corrected to load the real AppShell and real current report-filter
controls; no production layout workaround was added to force a passing result.

The established Event failures were rerun against **Ali's actual latest f65a689
baseline**, rather than assumed from the old report:

1. `test_host_cap_ownership_and_activity_locking`
2. `test_event_workers_complete_and_auto_cancel_once`
3. `test_event_create_publish_discovery_and_private_host_identity`

Each still receives HTTP 422 `safety_notes_required` during Event publish/restore.
The relevant Event implementation and tests are byte-unchanged from that baseline.
No Event business rule, fixture or teammate-owned module was edited. They remain
separate failures; the complete project regression cannot be described as all green.

Infrastructure used a new database `invatrace_botany_final_20261008`, Redis database
15 and a dedicated cached S3-compatible test container. Original source DB was
untouched. The cached image was
`quay.io/minio/minio:RELEASE.2024-12-18T13-15-44Z`; **literal current Compose pinned
image orchestration was NOT_TESTED**. Public deployed-site behavior, a live scan
classifier execution and new real-provider quality were not tested by these offline
browser fixtures. All owned local test servers/workers/storage container stopped;
database and container data remain retained.

Detailed local evidence is ignored under `.local-data/final-integration/`:
`backend.log`, `frontend.log`, `scan-browser.log`, `entrypoints-browser.log`,
`typescript.log`, `eslint.log`, `ruff.log`, `ruff-format.log`,
`ruff-changed-format.log`, `build.log`, `final-postgis.log`, `final-full-stack.log`,
`infrastructure.json`, `format-baseline.json`, `security.json`, `preservation.json`.
These are not publication candidates.

## Security/privacy review and candidate boundaries

The entire tracked diff and all candidate new files were reviewed. Secret-pattern
and actual configured-provider-secret checks found **zero matches** in candidate
content, diff, tracked repository files and generated frontend bundles. `.env`
files are absent from the index and the candidate set. The actual existing
`application/backend/.env` remains ignored/untracked in its original checkout;
no actual environment file was copied into the integration worktree.

Backend-only provider handling is preserved. Runtime provider/model names such as
Gemini, Groq and `openai/gpt-oss-120b` are legitimate configuration, not development
attribution. Candidate source/comments and intended delivery metadata contain no
prohibited development-assistant attribution. No secret values are included in the
report or test logs. Test placeholder strings are non-secret fixtures.

Map's provider envelope is covered by backend tests: no sighting UUID, coordinates,
private record details, user ID, session/rate-limit credential, chat history, auth
header, event data or whole knowledge pack is sent. General sends bounded
question/topic/depth; grounded sends bounded relevant botanical evidence. Source
URLs and safety wording remain backend-controlled. Unsupported/private Map lookup
is also verified with real PostGIS. API extras such as fake scan confidence,
coordinates or user IDs are rejected by the new typed contracts.

No `.env`, `.local-data`, logs, screenshots, database dumps, dependencies, build
outputs, temporary archives or raw local provider ledgers are in the candidate.
Nothing is staged. The exact **23** changed/untracked candidate files are:

```text
backend/app/api/routers/plant_assistant.py
backend/app/domain/assistant_general_knowledge.py
backend/app/services/assistant_general_knowledge.py
backend/app/services/assistant_judge.py
backend/app/services/assistant_provider.py
backend/tests/fixtures/assistant_general_captured_outputs.json
backend/tests/integration/test_assistant_context_postgis.py
backend/tests/test_assistant_general_knowledge.py
backend/tests/test_assistant_map.py
docs/assistant-demo-checklist.md
docs/assistant-general-knowledge.md
reports/assistant_final_integration.md
scripts/check-assistant-entrypoints-ui.mjs
scripts/check-epic8-live-ui.mjs
scripts/check-epic8-local-ui.mjs
src/features/catalogue/CatalogueDetailPage.tsx
src/features/catalogue/GuidePlantAssistant.tsx
src/features/map/MapPlantAssistant.tsx
src/features/map/SightingDetailsSheet.tsx
src/features/map/ThreatMapPage.tsx
src/features/map/map-plant-assistant.css
src/features/scan/PlantAssistantPanel.test.ts
src/features/scan/PlantAssistantPanel.tsx
```

## Requirements review copy and approval status

Source:
`/Users/zack/Downloads/InvaTrace Iteration 3 Epics User Stories and Acceptance Criteria Updated 2026-10-08.docx`.
SHA256: `0d5757f31d642fa41e16c9f02de0e1c8b0e2553d7907cf9075c36ad759481da1`.

New output:
`/Users/zack/Downloads/InvaTrace_Iteration_3_Epic8_Final_Update_For_Nikhil.docx`.
33 pages rendered and visually inspected. All 17 original Epic 8 AC titles and
wording, unrelated document nodes, original styles/footer/geometry and every package
part except `word/document.xml` are preserved. Original DOCX hash is unchanged.
Ten relevant overview paragraphs were updated and 42 review paragraphs added; the
original historical revision notes remain explicitly distinguished from this local
candidate. No LeanKit update occurred.

Feature scope is approved under Nikhil's Option 2 decision and Zack's corrected
ownership. The DOCX separately marks these **PROPOSED — TEAM CONFIRMATION REQUIRED**:

- AC 8.3.3: harmless eligible general education after a verified ordinary evidence
  gap, Simpler/Standard only. Current literal “skips answer generation” conflicts
  with this exception; species-specific questions remain source-dependent.
- AC 8.3.5: grounded factual claims still require approved source support; General
  needs a separate factual-quality/safety/human-review acceptance process with
  empty citations. Schema PASS is not factual PASS or human approval.
- AC 8.1.5: accepted runtime failover is retained, but the literal AC names Gemini
  alone; exact wording clarification after configured failover is proposed.
- New Map and Guide criteria, provisional 8.4.x / 8.5.x, require team confirmation
  and board-ID allocation. Old scan AC 8.1.1 is not treated as automatic approval.

Historical source-only **17 PASS / 0 REVIEW**, release
`3f68bc61a5a990718c5c87cd2c5f6ea2cffcced3`, is a separate historical acceptance record.
It is not a new 17/17 claim for this extension, or a deployed-generation claim.
Earlier real Detailed outputs had factual concerns; Detailed is now excluded.
The prior four-call budget remains fully consumed. No new human factual approval or
reviewer identity/date is supplied or invented; allowed General S/S review remains
pending despite successful offline structure/routing tests.

## Gates and next action — initial 8 October review

| Gate | Value | Meaning |
|---|---|---|
| IMPLEMENTATION_READY | YES | Required local code and safe entrypoints are implemented and testable |
| GENERAL_KNOWLEDGE_READY | PENDING | S/S works offline; independent human factual acceptance is outstanding |
| MAP_ASSISTANT_READY | YES | M01–M20 passed with actual map UI and bounded mocked API |
| GUIDE_ASSISTANT_READY | YES | Actual guide shared UI and G01–G07 passed |
| REGRESSION_COMPLETE | NO | Execution completed; three Event failures and baseline formatting prevent an all-green full-project gate |
| AC_SCOPE_APPROVED | PENDING | Feature scope approved; exact AC exceptions/new criteria remain proposed |
| HUMAN_REVIEW_COMPLETE | PENDING | No invented factual/reviewer approval |
| SAFE_TO_COMMIT | PENDING | Technical secret/content review passes; release decisions and Zack publication approval are outstanding |
| SAFE_TO_DEPLOY | NO | No deployment authorisation; acceptance and production rollout checks are outstanding |

No unresolved assistant implementation conflict was found. Release blockers are
pending General S/S human factual review, exact AC confirmation and explicit Zack
publication approval. The separate Event failures/full-repository formatting are
reported for the team's project regression decision; they were not “fixed” by
changing unrelated code. No-selection Map chat, unresolved semantic Detailed,
unchanged class 23 ambiguity and untested literal production orchestration remain
explicit limitations.

Next action: Zack reviews the local candidate, DOCX and demonstration checklist;
obtain real factual/AC decisions, then explicitly approve any separately scoped
publication. A later deployment task must roll out the compatible backend first,
verify old clients, then the updated frontend. This task stops here.

## English message Zack can send to Nikhil — initial 8 October draft

> I’ve completed the local integration on Ali’s latest verified main in a separate
> worktree. Scan Result, Map and Plant Guide now use the same Plant Assistant.
> General Knowledge supports Simpler and Standard only, with Detailed blocked by
> the backend; grounded RAG keeps all three depths and citations. Backend, frontend
> and all 56 offline browser groups pass, and the production build passes. The
> three existing Event/PostGIS tests still fail on missing safety notes and are
> recorded separately. I’ve prepared the updated Epic 8 DOCX and demo checklist.
> General factual human review and the proposed AC wording still need confirmation.
> Nothing has been committed, pushed or deployed, and no new real model calls were
> made.

## Event fixture correction — 9 October 2026

Zack authorised this narrow correction after supplying Ali's decision:
"Go ahead bro. I didn't notice it. Patch it up." Work remained in
`feat/general-botany-release`, at unchanged HEAD
`f65a68990a5d6c7d0faed9d2e7ca6b281c091957`.

All three original tests were individually reproduced before editing, each with
0 PASS / 1 FAIL / 0 SKIP, exit 1. Their publish/restore paths lacked safety notes.
AC 9.6.5 was reread in the authoritative 2026-10-08 DOCX: published events require
permission context and safety notes, with observe/report framing and no removal
permission granted by hosting or joining. The document was not changed.

The entire fix is **four fixture-field additions in three test files**:

- `backend/tests/integration/test_iteration3_edges_postgis.py`: the local payload
  builder now supplies `safetyNotes`.
- `backend/tests/integration/test_iteration3_lifecycle_postgis.py`: both directly
  constructed published Event fixtures now supply `safety_notes`.
- `backend/tests/integration/test_iteration3_postgis.py`: the create payload now
  supplies `safetyNotes`.

Each uses: "Observe and report; hosting or joining grants no removal permission."
No original assertion was removed or weakened. Creation still permits a draft
without notes; publication and automatic-cancellation restoration still enforce
the unchanged production guard. No Event router, schema, model, migration,
authentication, permission rule, worker, Assistant implementation, provider
configuration or authoritative AC wording changed.

| Current verification | PASS | FAIL | SKIP | Test exit |
|---|---:|---:|---:|---:|
| A1: host cap, ownership and activity locking | 1 | 0 | 0 | 0 |
| A2: completion and automatic cancellation | 1 | 0 | 0 | 0 |
| A3: publish, discovery and private host identity | 1 | 0 | 0 | 0 |
| B: all seven Iteration 3 Event/follow-up PostGIS modules | 7 | 0 | 0 | 0 |
| C: complete PostGIS suite, including Assistant context | 12 | 0 | 0 | 0 |
| D: existing real local full-stack suite | 5 | 0 | 0 | 0 |
| E: complete backend regression | 1,253 | 0 | 11 | 0 |
| F: focused Assistant regression, nine modules | 940 | 0 | 0 | 0 |
| Additional exact negative safety verification | 1 | 0 | 0 | 0 |

The additional non-public validation reused the existing Event test fixture and
real local API/PostGIS endpoints. Omitting safety notes from both creation and
publication requests, and publishing with null, empty or whitespace notes, each
returned HTTP 422 `safety_notes_required`. Rejections preserved the draft and its
stored values; valid notes published successfully. Original permission/ownership,
activity-locking, worker idempotence, public-discovery and private-host assertions
all passed. Infrastructure-gated skips remain skips, not PASS.

Full-backend Ruff check passed. Three-file Ruff format check passed for two files;
the third has two formatting differences also reproduced in its unchanged HEAD
version. Those pre-existing lines were left intact. No global formatting was run.

Tests reused isolated database `invatrace_botany_final_20261008`, Redis database
15 and the retained local test storage. Full stack used its own API port; its
API/workers were stopped afterwards, while the existing webpage preview and
infrastructure stayed running. **Data-preservation caveat:** the existing cleanup
worker removed two pre-existing expired upload-grant records in this test
database. All other pre-existing database row hashes were preserved. The data
guard therefore exited **2**, separately from the full-stack pytest exit **0**.
The worker also invokes staging-object deletion; their prior object existence
was not captured, so historical staging-object preservation cannot be claimed.
This was insufficient isolation preparation, not an Event policy or fixture
change. No restoration, further cleanup or production-database operation was
attempted.

Final scope is **26 unstaged candidate files**: the initial 23 plus exactly the
three Event test files above. The existing report is updated here; all other 22
Assistant candidates, including the latest Map button changes, retain their
initial bytes. Other tracked source files, HEAD, branch and index were preserved.
Candidate/diff configured-key checks, secret patterns and candidate Gitleaks scan
found zero secrets; real environment configuration remains ignored/untracked.
No logs, screenshots, local data, dependencies, dumps or temporary validation
files enter the candidate set. Legitimate provider names/configuration remain
intact; no development-assistant attribution was added.

Exact commands, JUnit results, safety checks, source hashes and redacted security
evidence are local-only under
`/private/tmp/invatrace-event-fixture-20261009-r6f2jvys/`. Test processes loaded
blank provider keys with generation/failover disabled and a loopback-only network
guard. Real external inference requests: **0**.

**EVENT_FIXTURE_READY_FOR_REVIEW=YES.** No Event or Assistant test failures remain
in these runs. General S/S human factual review, proposed AC approvals and explicit
publication approval are still pending; the baseline formatting and the noted
test-data side effect remain disclosed. No staging, commit, push, merge, deployment,
team-main edit or ZIP replacement was performed.

## Acceptance confirmation and current publication state — 9 October 2026

Zack quoted the two previously reported pending items:

1. General Knowledge AC exceptions and Map/Guide entrypoint acceptance criteria.
2. General Knowledge real-answer human review.

He then stated: "这个现在是确认过了的" (these have now been confirmed).
This is direct user confirmation that both decisions are complete. No reviewer
name, actual review date, separate minutes or detailed comments were supplied.
The date above is the confirmation receipt date, not an invented review date;
Zack is not assumed to be the actual reviewer.

- `AC_SCOPE_APPROVED=YES` for the discussed General Knowledge AC 8.3.3 / 8.3.5
  exceptions and Map/Guide entrypoint criteria, retaining General Simpler/Standard
  only and all grounded, safety, context and privacy restrictions.
- `HUMAN_REVIEW_COMPLETE=YES`, based on Zack's confirmation of the completed
  General Knowledge real-answer review.
- `GENERAL_KNOWLEDGE_HUMAN_REVIEW_PENDING=NO` for that supported scope.
- Actual reviewer name/date: `NOT_PROVIDED`. Exact confirmation is recorded above;
  no additional team decision or comments are invented.
- `SAFE_TO_COMMIT=PENDING_CURRENT_PUBLICATION_PREFLIGHT_AND_AUTHORISATION`.
- `SAFE_TO_PUSH=PENDING_CURRENT_PUBLICATION_PREFLIGHT_AND_AUTHORISATION`.
- `DEPLOYED=NO`.

This record supersedes earlier pending AC/human-review gates for these two items.
It does not assign new story IDs, alter authoritative DOCX wording, approve
excluded General Detailed or extend historical source-only 17/17 PASS to every
new criterion. Current acceptance is recorded separately from those historical
results; acceptance confirmation alone is not permission to commit or publish.

Latest UI-only verification recorded 308 frontend tests and 66 browser groups
(37 Scan + 29 entrypoint) PASS, plus TypeScript, ESLint and production build PASS.
Three shared UI files changed in that round; all other existing work, HEAD and the
index were preserved. No real inference ran in the UI round. The separate
five-key live round consumed 6/6 requests: slots 1, 2, 4 and 5 succeeded, slot 3
timed out, and controlled-429 switching reached slot 2 but that request timed out.
Those technical outcomes remain unchanged by the review confirmation.

Only the two existing acceptance/report Markdown files are updated for this
confirmation. Product code, provider settings, environment credentials, original
DOCX files, Git index and Git HEAD remain untouched. The historical 26-file scope
predates later UI/key-pool work and cannot be reused as the current publication
whitelist. Current file selection, secret/metadata checks and destination/remote
verification must be completed within a separately authorised Git task.
