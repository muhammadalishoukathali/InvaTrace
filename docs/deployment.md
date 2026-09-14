# Deployment: Cloudflare Pages, Render, Neon, and R2

This runbook matches the approved Iteration 1 deployment boundaries.

## Neon PostgreSQL/PostGIS

Create a Neon database and use its pooled TLS URL with the `psycopg` SQLAlchemy
scheme, for example `postgresql+psycopg://...?...sslmode=require`. Run
`alembic upgrade head` before a manual import. The checked-in Render deployment
also runs migrations and the production-safe species reference loader from the
container entrypoint because the free plan has no pre-deploy command. The
initial migration enables `postgis`, creates the normalized schema, and creates
the spatial indexes. The database role must be permitted to create the
extension on first deployment; Neon supports PostGIS in the target database.

Back up before destructive future migrations. Deploy additive migrations before
code that requires them, and run `alembic check` in CI to detect model drift.

After migration and reference-data loading, import the checked-in GBIF release
and derive the OSM place, protected-area and directed-waterway releases from one
verified PBF. Every stage is bound to the same PBF SHA-256, replication timestamp
and reviewed Malaysia boundary. Hash, byte-length, licence, timestamp and
coverage mismatches fail closed. The regional PBF is intentionally ignored by
Git and must never be committed.

The supported Windows runbook is `scripts/import-production-geodata.ps1`. It
downloads the current official Geofabrik Malaysia/Singapore/Brunei PBF when no
path is supplied, verifies the upstream MD5 and embedded replication timestamp,
runs migrations and every import, writes auditable derived manifests, and ends
with the production-data readiness check. Supply `DATABASE_URL` only through the
process environment:

```powershell
python -m pip install -e .\backend
$env:DATABASE_URL = "postgresql+psycopg://<user>:<password>@<host>/<database>?sslmode=require"
.\scripts\import-production-geodata.ps1 -Python python
```

To repeat an import from the exact PBF already named by
`data/production/osm-places/release.json`, pass its local path. The script refuses
to continue if its bytes or reviewed-boundary checksum differ from the manifest:

```powershell
.\scripts\import-production-geodata.ps1 `
  -Python python `
  -PbfPath D:\data\malaysia-singapore-brunei-latest.osm.pbf
```

The directed-waterway phase performs exact PostGIS geography snapping for
every imported place. It normally takes several minutes but can take longer over
a remote database connection. Its CLI prints the edge/evidence summary only
after the transaction completes. Do not interrupt it solely because the console
is quiet; check the database for changing, non-blocked `waterway_edges` queries
first.

For a release review without a database write, prepare and verify the latest PBF
from the repository root:

```bash
python scripts/prepare-osm-release.py \
  --download-latest \
  --places-manifest data/production/osm-places/release.json \
  --boundary-manifest data/production/malaysia-boundary/release.json
```

After any import, both commands below must succeed. `production-data-status`
exits non-zero if the approved catalogue, place geometry, occurrence coverage,
protected-area release, or waterway graph is missing. `/health/ready` exposes the
same result as `geospatialData` and returns HTTP 503 while it is degraded.

```bash
cd backend
python -m app.cli production-data-status
python -m alembic check
```

## Cloudflare R2

Create a private bucket and an R2 S3 API token scoped only to that bucket. Set:

- `S3_ENDPOINT_URL` and `S3_PUBLIC_ENDPOINT_URL` to the account R2 S3 endpoint.
- `S3_REGION=auto`.
- `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` from the scoped
  token.
- `S3_FORCE_PATH_STYLE=true` unless the chosen R2 endpoint requires virtual-host
  addressing.
- `UPLOAD_CLEANUP_INTERVAL_SECONDS=3600` for the cleanup background process.

Configure bucket CORS to allow the exact Cloudflare Pages production origin and
preview origins you intentionally support, with `PUT`, `GET`, and `HEAD`, the
`Content-Type` and `x-amz-*` request headers, and `ETag` exposed. Do not enable
public bucket access. The API generates short-lived signed URLs and validates
the object with the private credential before accepting a report. Submission
copies each upload to an immutable `evidence/` key before the worker reads it,
so an expired upload URL cannot replace accepted evidence.

Run a third private background process with `python -m app.cli cleanup-worker`.
It cleans immediately at startup and then hourly by default; set
`UPLOAD_CLEANUP_INTERVAL_SECONDS` to change the interval. The worker only
expires unconsumed keys matching `uploads/<profile>/<uuid>.jpg` and processes
durable deletion jobs created when a report or sighting is removed. Failed
evidence and thumbnail deletions remain queued with backoff until storage
recovers. It is safe to restart or run more than once.
The Compose stack includes this process as `upload-cleanup`.

A bucket lifecycle rule may also delete objects under `uploads/` after one day.
Do not apply that rule to `evidence/` or `thumbnails/`.

## Render API and worker

The checked-in free-plan blueprint creates one API service and runs verification
and upload cleanup inside that process. A paid deployment may split those into
two private background workers using the commands below.

API settings:

- Start command: the Dockerfile default, or `uvicorn app.main:app --host 0.0.0.0
  --port $PORT`. If proxy headers are enabled, set `FORWARDED_ALLOW_IPS` to the
  actual trusted proxy range rather than accepting forwarded headers from every
  address.
- Health check path: `/health/live`.
- Startup entrypoint: migration plus the production-safe reference loader,
  followed by the API process.

Worker settings:

- Start command: `python -m app.cli worker`.
- No public port or health endpoint is required; monitor process health and the
  `verificationBacklog` field from `/health/ready`.

Upload-cleanup settings:

- Start command: `python -m app.cli cleanup-worker`.
- No public port is required. A successful run logs
  `expired_upload_cleanup_completed`; process failures should trigger the normal
  background-service restart policy.

Set identical database, Redis, object-storage, credential-hash, location-privacy,
and screening variables on both services. Use separate random values of at least 32
bytes for `JWT_SECRET`, `CREDENTIAL_HASH_KEY`, and `LOCATION_PRIVACY_KEY`. Set
`APP_ENV=production`, explicit `CORS_ORIGINS`, and the supported
`E1_MODEL_VERSIONS`. The E2 worker uses deterministic rules and requires no
second model artifact. Configure its image, perceptual-hash, distance, and time
thresholds from `backend/.env.example`. Never copy the Compose secrets.

Redis is required for production rate limiting. Production is fail-closed for
rate-limited operations when Redis is unavailable.

## Cloudflare Pages frontend

Build command: `npm run build`. Output directory: `dist`.

Set only public build configuration:

- `VITE_API_BASE_URL=https://<render-api-host>`
- `VITE_ENABLE_MOCKS=false`
- `VITE_ENABLE_FAKE_MODEL=false`
- `VITE_ENABLE_REAL_MODEL=true`
- `VITE_MODEL_BASE_URL=/models/pulih-model1-v4`
- `VITE_MAP_TILE_URL` to the production raster-tile template
- `VITE_MAP_TILE_ATTRIBUTION` to the provider's required attribution
- `VITE_RELEASE_ID` to the deployment revision

No database, R2, HMAC, JWT, or Redis secret belongs in a `VITE_` variable.

## Release verification

Run migrations, seed only in non-production environments, and verify in order:

```bash
curl -fsS https://<render-api-host>/health/live
curl -fsS https://<render-api-host>/health/ready
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e:real
backend/.venv/bin/pip-audit -r backend/requirements.lock
```

For browser-model regression checks, also run `npm run test:e2e:model-ui`; the
normal Playwright suite exercises the real PULIH runtime directly with WebGPU
disabled to prove the WASM fallback, retry, and single-session behaviour.

For production, exercise private access start/acknowledge/bootstrap, restore with
a one-time recovery code, upload/report replay with the same idempotency key,
automated screened/rescan/reject/merge states, report-status polling,
rule-screened public map visibility, place association, location reduction,
and notification read flows. Confirm identity responses are never cached and
that R2 objects cannot be fetched without a signed URL.
