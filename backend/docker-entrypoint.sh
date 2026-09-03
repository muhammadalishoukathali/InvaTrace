#!/bin/sh
# AC 1.2.1 — idempotent production startup. Migrates the schema and loads
# reference data (species catalogue + monitored places) before uvicorn
# begins serving. Reference-data loader is safe to re-run; demo seeding
# never runs here.
set -eu

alembic upgrade head
python -m app.cli load-reference-data

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips "*"
