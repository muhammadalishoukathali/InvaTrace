"""FastAPI app factory and process-wide wiring.

Builds the actual FastAPI instance: registers every router, sets up
CORS, structlog, and a request-context middleware that stamps a
request ID and a handful of security headers onto every response.
Uvicorn/gunicorn point at the `app` object created at the bottom of
this file.
"""

from __future__ import annotations

import asyncio
import os
import re
import uuid
from contextlib import asynccontextmanager, suppress

import httpx
import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import (
    admin,
    adopted_areas,
    catalogue,
    health,
    identify,
    identity,
    location,
    notifications,
    offline_pack,
    places,
    reports,
    scans,
    sightings,
    species,
    uploads,
)
from app.config import get_settings
from app.core.errors import install_error_handlers, request_id_var

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.JSONRenderer(),
    ]
)
log = structlog.get_logger("invatrace.api")
# Client-supplied X-Request-ID has to look like this before we trust it and echo
# it back - otherwise we just generate our own uuid4 below.
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,100}$")


async def _run_worker_loop(name: str, sync_step, poll_seconds: float) -> None:
    """Wrap a blocking sync worker step in an asyncio loop. Each iteration runs
    in a worker thread (SQLAlchemy Session, time.sleep, etc. are blocking), so
    the API event loop stays responsive."""
    while True:
        try:
            await asyncio.to_thread(sync_step)
        except Exception:
            log.exception("in_process_worker_step_failed", worker=name)
        await asyncio.sleep(poll_seconds)


def _self_keepalive_target(settings) -> str | None:
    """Liveness URL the API should ping on itself, or None when disabled or
    when there is no public URL to reach (local dev, tests)."""
    if not settings.self_keepalive_enabled:
        return None
    base = settings.self_keepalive_url or os.environ.get("RENDER_EXTERNAL_URL")
    if not base:
        return None
    return f"{base.rstrip('/')}/health/live"


async def _run_self_keepalive(url: str, interval_seconds: float) -> None:
    """Hit our own public URL on a timer. The request has to leave the
    container and come back through Render's edge to count as traffic, which
    is why this goes to the public URL rather than localhost."""
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            await asyncio.sleep(interval_seconds)
            try:
                response = await client.get(url)
                log.info("self_keepalive_ping", status=response.status_code)
            except httpx.HTTPError as error:
                log.warning("self_keepalive_ping_failed", error=type(error).__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Optionally spawn verification + cleanup workers inside the API process.
    Enabled by RUN_WORKERS_IN_API=1 for free-tier deploys that can't run a
    separate worker service."""
    settings = get_settings()
    tasks: list[asyncio.Task] = []
    if settings.run_workers_in_api:
        from app.cli import cleanup_uploads_once
        from app.workers.verification import run_worker

        tasks.append(
            asyncio.create_task(
                _run_worker_loop(
                    "verification", lambda: run_worker(once=True), settings.worker_poll_seconds
                ),
                name="invatrace.verification-worker",
            )
        )
        tasks.append(
            asyncio.create_task(
                _run_worker_loop(
                    "cleanup",
                    lambda: cleanup_uploads_once(500),
                    settings.upload_cleanup_interval_seconds,
                ),
                name="invatrace.cleanup-worker",
            )
        )
        log.info("in_process_workers_started")
    keepalive_url = _self_keepalive_target(settings)
    if keepalive_url:
        tasks.append(
            asyncio.create_task(
                _run_self_keepalive(keepalive_url, settings.self_keepalive_interval_seconds),
                name="invatrace.self-keepalive",
            )
        )
        log.info("self_keepalive_started", url=keepalive_url)
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError, Exception):
                await task


def create_app() -> FastAPI:
    """Assemble the FastAPI app. Called once at import time to build the
    module-level `app` object below - keeping it in a function (rather than
    top-level statements) makes it easy to spin up a fresh app in tests."""
    settings = get_settings()
    app = FastAPI(
        title="InvaTrace API",
        version="0.1.0",
        docs_url="/docs",
        redoc_url=None,
        openapi_url="/openapi.json",
        lifespan=_lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "X-InvaTrace-Queued",
            # AC Iteration 1 P1 - the report submission sends the client's
            # bundled catalogue version + SHA so the server can reject a
            # submission built against a stale offline catalogue. Both
            # headers MUST be preflight-allowed or CORS blocks the POST.
            "X-InvaTrace-Catalogue-Version",
            "X-InvaTrace-Catalogue-Sha256",
            "X-Request-ID",
        ],
        expose_headers=["Retry-After", "X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        # Reuse an incoming request id (useful when a client/gateway already
        # set one, e.g. for tracing across services) as long as it's not junk;
        # otherwise mint our own so every log line and response can be tied
        # back to a single request.
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if REQUEST_ID_PATTERN.fullmatch(incoming) else str(uuid.uuid4())
        token = request_id_var.set(request_id)
        structlog.contextvars.bind_contextvars(request_id=request_id)
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Referrer-Policy"] = "no-referrer"
            # API is JSON-only; block all sub-resource loads if a response
            # is ever rendered directly in a browser tab.
            response.headers["Content-Security-Policy"] = (
                "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
            )
            response.headers["X-Frame-Options"] = "DENY"
            if settings.app_env == "production":
                response.headers["Strict-Transport-Security"] = (
                    "max-age=31536000; includeSubDomains"
                )
            # Profile data and anything sent with an auth header is per-identity and
            # private - make sure a shared proxy/browser cache never keeps a copy.
            if request.url.path.startswith("/api/v1/profiles") or request.headers.get(
                "authorization"
            ):
                response.headers["Cache-Control"] = "private, no-store"
                response.headers["Pragma"] = "no-cache"
            log.info(
                "request.complete",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
            )
            return response
        finally:
            structlog.contextvars.clear_contextvars()
            request_id_var.reset(token)

    install_error_handlers(app)
    # Order doesn't matter for routing (paths are distinct) but keeping health
    # first is nice for readability when scanning the OpenAPI docs.
    for router in (
        health.router,
        identity.router,
        species.router,
        species.model_config_router,
        notifications.router,
        uploads.router,
        scans.router,
        identify.router,
        reports.router,
        sightings.router,
        location.router,
        catalogue.router,
        offline_pack.router,
        places.router,
        adopted_areas.router,
        admin.router,
    ):
        app.include_router(router)
    return app


app = create_app()
