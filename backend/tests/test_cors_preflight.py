"""Regression test for the report-submission CORS preflight.

The deployed frontend at https://invatrace-web.onrender.com sends two
report-integrity headers on every POST /api/v1/reports:

  * X-InvaTrace-Catalogue-Version
  * X-InvaTrace-Catalogue-Sha256

If either header is missing from the CORSMiddleware allow_headers list,
Starlette rejects the browser preflight with HTTP 400 "Disallowed CORS
headers" before the endpoint or rate limiter is reached. This test pins
both headers into the allow list so a future edit cannot silently drop
them and re-break production.

Runs offline - only the FastAPI TestClient walks the middleware stack,
no DB / Redis / object storage is touched.
"""

from __future__ import annotations

import importlib

import pytest

FRONTEND_ORIGINS = (
    "https://invatrace-web-siul.onrender.com",
    "https://invatrace-web.onrender.com",
    "https://invatrace.pages.dev",
)
REQUESTED_HEADERS = (
    "authorization,content-type,idempotency-key,"
    "x-invatrace-catalogue-version,x-invatrace-catalogue-sha256"
)


@pytest.fixture
def preflight_client(monkeypatch: pytest.MonkeyPatch):
    # Force the production frontend origin into the CORS allow list, then
    # rebuild the app so its middleware stack picks the fresh settings up.
    from fastapi.testclient import TestClient

    from app.config import get_settings

    monkeypatch.setenv("CORS_ORIGINS", ",".join(FRONTEND_ORIGINS))
    get_settings.cache_clear()
    import app.main as app_main

    importlib.reload(app_main)
    try:
        yield TestClient(app_main.app)
    finally:
        # Prevent a monkeypatched setting from leaking into later tests.
        get_settings.cache_clear()
        importlib.reload(app_main)


@pytest.mark.parametrize("origin", FRONTEND_ORIGINS)
def test_reports_preflight_allows_catalogue_headers(preflight_client, origin: str) -> None:
    response = preflight_client.options(
        "/api/v1/reports",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": REQUESTED_HEADERS,
        },
    )
    assert response.status_code == 200, (
        f"CORS preflight for POST /api/v1/reports must succeed for the deployed"
        f" frontend origin. Got {response.status_code}: {response.text!r}."
    )
    assert response.headers.get("access-control-allow-origin") == origin
    allowed = response.headers.get("access-control-allow-headers", "").lower()
    for required in (
        "authorization",
        "content-type",
        "idempotency-key",
        "x-invatrace-catalogue-version",
        "x-invatrace-catalogue-sha256",
    ):
        assert required in allowed, (
            f"Preflight allow-headers missing `{required}`; report submission"
            " will fail with a 400 'Disallowed CORS headers' in production."
        )


def test_cors_middleware_lists_both_catalogue_headers_explicitly() -> None:
    # Belt-and-braces source-text pin: even if a future refactor stops
    # exercising the TestClient path above, dropping either header from
    # main.py's allow_headers list must still fail this suite loudly.
    from pathlib import Path

    source = (Path(__file__).resolve().parents[1] / "app/main.py").read_text()
    assert '"X-InvaTrace-Catalogue-Version"' in source
    assert '"X-InvaTrace-Catalogue-Sha256"' in source
    # Wildcard would silently permit anything and hide future regressions.
    assert 'allow_headers=["*"]' not in source
