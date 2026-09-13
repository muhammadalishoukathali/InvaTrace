# shared/catalogue

Single source of truth for the InvaTrace Malaysian plant catalogue and safe guidance.

Both the frontend (`src/data/*`) and backend (`backend/app/seed.py`, ORM loaders)
read from this directory. Never maintain a parallel copy elsewhere.

## Files

- `approved-species.json` - the evidence-reviewed Iteration 2 allowlist of exactly
  32 invasive plants recorded as present in Malaysia. Catalogue, reporting,
  occurrence association, and adoption analytics must never associate a species
  outside this file.
- `plant-status.json` - compatibility metadata for the currently shipped 31-class
  PULIH model. It is not the business allowlist and may contain model classes that
  are intentionally unsupported by the current catalogue.
  authoritative Malaysian `ui_state`, `general_information`, `safety_message`,
  `status_source_ids`, `status_reviewed_at`, and `report_eligible` flag.
- `plant-guidance.json` - reviewed per-species safe guidance (safe passive
  actions, permitted beginner active actions, stop conditions, spread-prevention,
  prohibited actions, source references).
- `catalogue-manifest.json` - `catalogue_version`, `last_reviewed`, released
  `model_version`, plus SHA-256 checksums of the two data files.
- `schemas/*.schema.json` - JSON Schemas both files must satisfy. Enforced by
  `scripts/validate-catalogue.mjs` (frontend build/tests) and by
  `backend/app/domain/catalogue.py` (backend startup / reference load).

## Updating the catalogue

1. Edit `plant-status.json` and/or `plant-guidance.json`.
2. Bump `catalogue_version` in `catalogue-manifest.json`.
3. Run `node scripts/update-catalogue-manifest.mjs` to refresh the SHA-256
   checksums and `content_version`. Commit the manifest change.
4. Run frontend `npm test` and backend catalogue tests. The approved catalogue
   must contain exactly 32 unique species. The classifier manifest is validated
   separately because the replacement 32-class model is still pending.

The frontend and backend must ship the same `catalogue_version` and matching
`sha256` for `plant-status.json`. Report submission is rejected with a
retryable version-mismatch response when they differ; identification and
offline guidance continue to work in that case.
