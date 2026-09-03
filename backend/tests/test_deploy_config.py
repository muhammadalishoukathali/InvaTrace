"""Regression tests for the production deploy blueprint.

AC Iteration 1 P11 — the prod init on Render must satisfy a handful of
non-obvious constraints that only bite once traffic hits the deployment:

  1. Schema migrations run BEFORE the new image serves traffic; without
     `preDeployCommand`, a startup-time model query races the migrator
     and 500s on the first request after a schema change.
  2. Uvicorn trusts Render's proxy headers, otherwise every request looks
     like it comes from Render's edge IP and the per-IP burst rate limit
     collapses to one shared bucket across the platform.
  3. Duplicate detection stays on in prod — the dev-only kill switch
     must not silently follow a rebased branch to production.
  4. The single 300 m GPS policy is pinned explicitly at the platform
     level so a config drift is visible in code review, not surfaced by
     a rescan whose threshold does not match anything in the UI.
  5. Static frontend headers: long-lived `Cache-Control` on hashed
     assets, `no-store` on the service-worker entry point so an update
     replaces the shell instead of a stale copy being served forever.

These are source-text asserts on render.yaml and the backend Dockerfile
so the tests do not need docker / Render's own linter to run.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _read(relative: str) -> str:
    return (REPO_ROOT / relative).read_text()


def test_render_yaml_runs_migrations_before_serving() -> None:
    render = _read("render.yaml")
    assert "preDeployCommand: alembic upgrade head" in render, (
        "Without a preDeployCommand the first request after a schema change"
        " races the migrator and 500s."
    )


def test_render_yaml_declares_the_gps_and_dedup_policy_env_vars_explicitly() -> None:
    render = _read("render.yaml")
    assert 'key: SCREENING_LOCATION_ACCURACY_MAX_M\n        value: "250"' in render, (
        "The single 250 m GPS policy must be pinned explicitly at deploy time"
        " so a config drift is caught in review, not by a surprise rescan."
    )
    assert 'key: SCREENING_DISABLE_DUPLICATE_CHECK\n        value: "false"' in render, (
        "The dev-only duplicate-check kill switch must be forced off in prod."
    )


def test_render_yaml_declares_expected_frontend_cache_headers() -> None:
    render = _read("render.yaml")
    # Hashed asset bundle can safely be cached forever; a rebuild issues a
    # new URL so the browser fetches the new file automatically.
    assert "path: /assets/*" in render
    assert "public, max-age=31536000, immutable" in render
    # Service worker is the authority on the current shell — it must never
    # be served from a cached copy.
    assert "path: /sw.js" in render
    assert "value: no-store" in render


def test_render_yaml_health_check_hits_the_liveness_endpoint() -> None:
    render = _read("render.yaml")
    # /health/live is unauthenticated and does not touch the DB, which is
    # what Render's outer restart-on-fail probe should hit — /health does
    # a full readiness check and would flap during a DB blip.
    assert "healthCheckPath: /health/live" in render


def test_backend_dockerfile_trusts_proxy_headers_for_rate_limiting() -> None:
    dockerfile = _read("backend/Dockerfile")
    assert "--proxy-headers" in dockerfile
    assert '--forwarded-allow-ips' in dockerfile
    assert '"*"' in dockerfile.split("CMD", 1)[1], (
        "forwarded-allow-ips must accept Render's inner IP; without a trusted"
        " list the X-Forwarded-For chain is ignored and rate limiting collapses"
        " to one bucket per platform edge."
    )


def test_backend_dockerfile_healthcheck_uses_the_liveness_endpoint() -> None:
    dockerfile = _read("backend/Dockerfile")
    assert "HEALTHCHECK" in dockerfile
    assert "/health/live" in dockerfile, (
        "Container HEALTHCHECK must hit the DB-free liveness endpoint,"
        " otherwise a slow migration will fail the probe and force a restart"
        " loop before the migrator finishes."
    )
