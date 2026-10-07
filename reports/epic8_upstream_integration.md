# Epic 8 integration into the team repository

Recorded: 2026-10-07 (Asia/Kuala_Lumpur).

Target repository: https://github.com/muhammadalishoukathali/InvaTrace
Target baseline: `d1320228a59f2f7cf8c731060556be471cdbb412` (`main`).
Integration branch: `feat/epic8-grounded-assistant`.
Verified release source: `3f68bc61a5a990718c5c87cd2c5f6ea2cffcced3` in https://github.com/zackzzhangg/InvaTrace-RAG.

## Scope and preservation

The source repository stores the application under `application/`; the team repository stores it at the root and has independent Git history. This integration starts from the team's current baseline and imports only Epic 8 code, evidence and required test resources. It does not merge either repository's unrelated history or replace the team's application.

There are 41 candidate paths: the original 26 release paths mapped to the root, plus 15 required integration/test/documentation paths. Seven existing team files receive bounded insertions: `backend/.env.example`, `backend/app/config.py`, `backend/app/core/rate_limit.py`, `backend/app/main.py`, `src/features/scan/ScanResultPage.tsx`, `src/mocks/handlers.ts` and `vite.config.ts`. Existing setting values, routes, scan/report guidance, workers, schemas, catalogue, GPS limits, authentication, package files and deployment configuration are retained.

The extra 15 paths are: `backend/app/main.py`, `backend/app/core/rate_limit.py`, `backend/app/domain/assistant_safety.py`, `src/features/scan/plant-assistant.css`, `src/features/scan/PlantAssistantPanel.test.ts`, `src/mocks/handlers.ts`, `vite.config.ts`, `tests/fixtures/epic8_answerability_cases.csv`, `tests/fixtures/epic8_bounded_safety_cases.json`, `tests/fixtures/epic8_bounded_safety_review_cases.json`, `reports/epic8_refusal_audit.csv`, `reports/epic8_refusal_audit.json`, `docs/epic8_ac_implementation_map.md` `reports/.gitattributes` and this report.

The three frozen fixtures and three protected historical inputs support the existing source-integrity regression. Their contents and expected hashes are retained. Imports in six new backend test files are sorted to satisfy the target repository's lint configuration; test behavior is preserved.

The endpoint retains lazy knowledge loading; the team's existing lifespan is preserved without adding the source release's optional eager retriever warmup. The active knowledge file is verified by the unit/browser suite. The narrow development proxy and mock passthrough apply only to plant questions.

## Regression on this integrated tree

- Backend after the approved privacy fix: 993 passed, 9 opt-in integration modules skipped in the default run.
- Epic 8: the 694 original targeted checks, including 143 provider-failover tests, grounding, safety and citations, plus 8 approved privacy regressions all pass within the final backend run.
- Frontend: 251 passed across 34 files.
- TypeScript, ESLint and changed-file Ruff checks/format checks pass.
- PostGIS: 10 passed, 1 separate full-stack opt-in module skipped.
- Real local full stack (API, workers, PostgreSQL/PostGIS, Redis and object storage): 5 passed.
- Browser: 18 groups passed, 24 local API POST requests, mobile 375 and desktop 1280 layouts.
- Actual Vite proxy to the actual registered application route: HTTP 200 with `unsupported_scan`, preserving the scan guard.

An initial PostGIS attempt named a nonexistent test database; it did not run the event checks. The final run uses the existing dedicated `invatrace_epic8_release_20261006` test database and passes. No production database is used. Vite emitted a dependency-scan cancellation during shutdown of the successful short proxy probe; the proxy response and browser/frontend checks passed.

No new external provider experiments were performed. Test provider traffic is controlled locally. Local helper API/browser/Vite/storage processes are stopped; evidence and test data are retained. Logs, screenshots, local data and dependencies are excluded from the commit.

## Acceptance and historical evidence

The source release acceptance remains 17 PASS / 0 REVIEW, with AC 8.1.5 recorded as a team-accepted scope exception to literal v2 wording. The explicit team no-issues review is user-attested; actual reviewer identity/date remain `NOT_DISCLOSED_BY_USER`. `GROQ_HUMAN_REVIEW_PENDING=NO` records that accepted decision, not an independently identified signature.

The three imported final release reports describe the source release and its original 26-file publication. Their historical live-provider evidence and acceptance qualifications are retained; they do not claim new provider calls or a 26-file scope for this 41-file integration. The imported refusal audits and older AC implementation map are immutable historical test inputs; their older intermediate statuses are superseded by the final source release reports and this integration regression.

Gemini remains primary, with Groq fallback only on eligible provider failure. Both unavailable yields the approved retrieved-source fallback. Provider generation remains disabled by default; the example environment contains empty credential placeholders. Actual environment files are excluded. The same bounded botanical context may reach the configured fallback; images, GPS, user identity, session credentials, history, incoming auth tokens, event data and the whole knowledge pack are excluded. Citations and safety remain controlled by the backend.

The integration is proposed on an isolated branch. No merge to team `main`, deployment or board update is included.

## Final independent review and approved privacy fix

Final review reproduced one previously uncovered source-release issue: a botanical question followed by an unlabelled, nonnumeric first-person residential disclosure could reach the semantic provider boundary with the full question. Reproduction used local mocks only; no private question was sent externally. The formatted-phone and numbered-address review examples were separately stopped by the numeric-aspect classifier and were not reproduced as provider leaks.

The user explicitly authorised the prepared two-file repair on this isolated branch. Two residential-disclosure patterns were added to `contains_private_details`, and eight regressions were added to `test_plant_assistant.py`. Five real router tests assert that residential disclosures reach neither search nor judge/generation/grounding; three ordinary botanical questions retain their prior privacy classification. All eight pass, the full backend now passes 993 tests, and the 18-group browser regression passes again. Independent read-only review confirms the reproduced disclosure path is closed.

This repair targets first-person residential disclosures using `live/reside/stay` and their tested contractions. It is not a universal personal-information detector. Provider settings, evidence, grounding validators, citation ownership and safety rules are retained. The source release's historical acceptance remains documented separately from this additional integration finding and repair.

Publication is limited to `feat/epic8-grounded-assistant`; merging to team `main` or deploying requires a separate instruction.

The target repository normally normalises text line endings. A `reports/.gitattributes` rule disables that conversion only for the immutable `epic8_refusal_audit.csv`; its original CRLF bytes and frozen SHA remain intact in the staged/committed object and checkout. Other team Git attributes and application files are unchanged.
