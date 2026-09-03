# shared/catalogue

Single source of truth for InvaTrace Iteration 1 plant status and safe guidance.

Both the frontend (`src/data/*`) and backend (`backend/app/seed.py`, ORM loaders)
read from this directory. Never maintain a parallel copy elsewhere.

## Files

- `plant-status.json` — 31 species records (one per PULIH model class) with the
  authoritative Malaysian `ui_state`, `general_information`, `safety_message`,
  `status_source_ids`, `status_reviewed_at`, and `report_eligible` flag.
- `plant-guidance.json` — reviewed per-species safe guidance (safe passive
  actions, permitted beginner active actions, stop conditions, spread-prevention,
  prohibited actions, source references).
- `catalogue-manifest.json` — `catalogue_version`, `last_reviewed`, released
  `model_version`, plus SHA-256 checksums of the two data files.
- `schemas/*.schema.json` — JSON Schemas both files must satisfy. Enforced by
  `scripts/validate-catalogue.mjs` (frontend build/tests) and by
  `backend/app/domain/catalogue.py` (backend startup / reference load).

## Updating the catalogue

1. Edit `plant-status.json` and/or `plant-guidance.json`.
2. Bump `catalogue_version` in `catalogue-manifest.json`.
3. Run `node scripts/update-catalogue-manifest.mjs` to refresh the SHA-256
   checksums and `content_version`. Commit the manifest change.
4. Run frontend `npm test` and backend catalogue tests to confirm the
   schema is satisfied and the model manifest / catalogue class counts still
   align.

The frontend and backend must ship the same `catalogue_version` and matching
`sha256` for `plant-status.json`. Report submission is rejected with a
retryable version-mismatch response when they differ; identification and
offline guidance continue to work in that case.
