# InvaTrace: conversational plant assistant and UI feedback handoff

Current implementation, prepared on 10 October 2026. Repository: https://github.com/muhammadalishoukathali/InvaTrace. Starting commit: eb1a55b722b158af1b432f17a4bc91c37bfa2cf5.

## Changes for GitHub

- Replaced the retired assistant generation/judge flow with conversation-first semantic interpretation, TF-IDF reviewed-source retrieval, response composition and citation/safety auditing. The old runtime and its obsolete tests were removed; the replacement has its own regression suite.
- The model interprets plant questions, statements, greetings, off-topic messages, identity requests and catalogue requests. Server-selected scan, catalogue or public-map context remains authoritative.
- Reviewed sources support cited claims. Botanical knowledge may supplement sparse evidence in separately labelled AI sections when the user allows it. Generated knowledge does not acquire reviewed citations or change the selected plant identity.
- Simpler, Standard and Detailed requests use the current question and bounded conversational context. The AI accuracy notice is collapsed by default.
- Preserved backend-only Gemini key slots 1 through 5, optional key-pool rotation and eligible Groq fallback. Model availability, quota and the existing environment flags still determine whether providers can run.
- Added green hover sweeps to ordinary controls, red feedback for sign-out, and slight enlargement of map-marker visuals without moving their positioned wrappers. Reduced-motion preferences are respected.
- Added MIT-licensed Tabler potted-plant geometry with a CSS growth animation for loading states. Once the map shell appears, no extra route/report/place loader floats over it; asynchronous status remains accessible.
- Added optional synthesized sounds, initially muted, for completed scans, confirmed report saves, removals and follow-ups. Enabling the setting plays a preview. Suspended audio is resumed where possible; blocked local storage retains the choice for the current tab.
- Corrected submitted-record counting, changed model-config caching to prefer the current online response, fixed scan-shell overflow, and corrected local MapLibre worker MIME handling.

## Scope preserved

No new database migrations, plant-model weights/classes, catalogue records, protected-area datasets, GPS policies or event business rules are included. The production Render blueprint, production Dockerfile, database connection settings and object-store settings were not changed. Backend event-test changes specify UTF-8 for Windows source reads; they do not change event behavior.

Existing startup code still performs its normal idempotent reference loading and any previously configured demo seeding. This update does not introduce a new seed or reset procedure for Render. Use the existing services and their databases; do not create replacement databases as part of this release.

## Render configuration

Production continues to use `render.yaml`: the backend builds `backend/Dockerfile`, and the static frontend builds with `npm ci && npm run build`. Local Docker files under `infrastructure/epic8-web/` and `compose.epic8.yaml` are for laptop testing only; their localhost URLs are not production build settings.

Keep the existing Render environment values. Credentials are read by the backend, not stored in the frontend or repository:

- `GEMINI_API_KEY`, optionally `GEMINI_API_KEY_2` through `GEMINI_API_KEY_5`.
- `GEMINI_KEY_POOL_ENABLED` controls optional pool rotation.
- `ASSISTANT_GENERATION_ENABLED`, `ASSISTANT_GENERATION_FREE_TIER` and `ASSISTANT_JUDGE_ENABLED` must be enabled for the conversational provider flow.
- `ASSISTANT_GENERATION_MODEL` must identify an available model; `ASSISTANT_JUDGE_MODEL` is optional.
- `GROQ_API_KEY`, `GROQ_MODEL` and `GROQ_FALLBACK_ENABLED` control the existing secondary provider.
- `PLANTNET_API_KEY` and `PLANTNET_PROJECT` retain their existing roles for backend identification.
- The production frontend's `VITE_API_BASE_URL` must remain the deployed backend URL. Never use a laptop localhost URL on Render.

No local `.env.gemini.local` or other secret environment file should be committed. A GitHub push does not copy local keys into Render. Existing Render values are reused by the existing services; their actual values and provider quotas require deployment verification.

## Validation before upload

- Backend isolated regression suite: 995 passed, 12 skipped. Network access was disabled for this run; no live LLM requests or production data writes were made by it.
- Frontend regression suite: 343 passed across 49 files.
- Frontend ESLint: passed.
- TypeScript/Vite production build: passed.
- Production backend Docker image build: passed.
- Local browser checks and user confirmation covered hover feedback, opt-in audio, map loading transitions and assistant behavior. The long-content scan-shell layout was checked on desktop and mobile; do not describe that as exhaustive testing of every real scan.
- Database/full-stack integration checks were not rerun against production. GitHub's existing release workflows run their own checks after upload.
- A targeted credential-pattern scan of changed/new files found no matching credentials. Ignored secret files, work, backups and outputs are excluded from Git.

## Local startup

From the repository root with Docker Desktop running:

```powershell
docker compose -p invatrace-epic8-rag-flow -f compose.yaml -f compose.epic8.yaml up -d
```

Open http://localhost:5175. The isolated local API is at http://localhost:18000. Existing local volumes contain the user's test records; do not delete or reset them.

After a frontend update, allow the service-worker update to finish and refresh if the tab still uses an older build. Sound remains opt-in under My profile.
