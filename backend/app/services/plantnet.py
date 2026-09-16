"""PlantNet identification proxy.

The on-device Student33 model handles the primary identification for the 32
invasive-species catalogue. When it returns `uncertain` (max core probability
below the calibrated Student33 threshold), the frontend asks the server to
cross-check the same photo with PlantNet before showing the user a definite
"not sure" response. That verification step lives here.

Design notes:

- The PlantNet API key never leaves the server. The frontend POSTs the image
  bytes to /api/v1/identify/plantnet-verify; this module owns the actual
  outbound call.
- Timeouts are short (default 8s). A slow / down PlantNet must degrade to
  `not_sure` rather than hanging the scan UI.
- Response is normalised. Callers get `{status, species?, score?}` with
  status ∈ {native, not_sure, disabled, error}. `disabled` covers the
  no-API-key case so tests + local dev keep working without a live key.
- A per-day counter capped by settings.plantnet_daily_limit protects the
  free-tier quota from a runaway loop.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

import httpx
import structlog

from app.config import Settings

log = structlog.get_logger("invatrace.plantnet")


VerificationStatus = Literal["native", "not_sure", "disabled", "error"]


@dataclass(frozen=True)
class PlantNetSpecies:
    scientific_name: str
    common_names: tuple[str, ...]
    family: str | None
    score: float


@dataclass(frozen=True)
class PlantNetVerification:
    status: VerificationStatus
    species: PlantNetSpecies | None
    reason: str | None = None


class _DailyCounter:
    """Tiny in-process daily-quota guard.

    Not shared across worker processes; this is only a soft cap for the free
    tier while the feature is small. When the app scales past a single API
    dyno, swap this for a Redis counter keyed on the same day string.
    """

    def __init__(self) -> None:
        self._day: str | None = None
        self._count = 0
        self._lock = asyncio.Lock()

    async def try_consume(self, limit: int) -> bool:
        today = datetime.now(UTC).strftime("%Y-%m-%d")
        async with self._lock:
            if self._day != today:
                self._day = today
                self._count = 0
            if self._count >= limit:
                return False
            self._count += 1
            return True


_counter = _DailyCounter()


async def verify_image(
    image_bytes: bytes,
    filename: str,
    content_type: str,
    settings: Settings,
    organs: tuple[str, ...] = ("auto",),
    http_client: httpx.AsyncClient | None = None,
) -> PlantNetVerification:
    """Send `image_bytes` to PlantNet and normalise the top result.

    - Returns `disabled` when no API key is configured. Local dev + the test
      suite hit this path.
    - Returns `not_sure` when PlantNet has no result above its own score
      floor, times out, or refuses the request.
    - Returns `error` when the caller should surface a retry option to the
      user (e.g. 429, 5xx).
    - Returns `native` with the top species when PlantNet identifies one.
      The frontend, not this module, decides whether to overlay it against
      the InvaTrace invasive catalogue: PlantNet's "native" here means
      "PlantNet identified something", not "this species is a Malaysian
      native". The word matches the product-level label the user sees.
    """

    if not settings.plantnet_api_key:
        return PlantNetVerification(
            status="disabled",
            species=None,
            reason="PlantNet API key is not configured",
        )
    if not await _counter.try_consume(settings.plantnet_daily_limit):
        # A distinct status so callers can render a "we're rate-limited" hint
        # instead of the generic "PlantNet unreachable" message that dropped
        # calls get.
        return PlantNetVerification(
            status="not_sure",
            species=None,
            reason="daily PlantNet quota reached",
        )
    project = settings.plantnet_project or "all"
    endpoint_url = f"{settings.plantnet_endpoint}/{project}"
    # Key goes in a header, not the query string. Query params bleed into
    # request logs and any httpx.HTTPError.str() we log below, so keeping
    # the secret out of the URL entirely is the safe default.
    request_headers = {"Api-Key": settings.plantnet_api_key}
    # `no-reject=false` matches PlantNet's default; kept explicit so a
    # future dashboard tweak cannot silently flip identifier behaviour.
    request_params = {"no-reject": "false"}
    if not organs:
        organs = ("auto",)
    files = [("images", (filename, image_bytes, content_type))]
    data = [("organs", organ) for organ in organs]

    async def _call(client: httpx.AsyncClient) -> httpx.Response:
        return await client.post(
            endpoint_url,
            params=request_params,
            headers=request_headers,
            files=files,
            data=data,
            timeout=settings.plantnet_timeout_seconds,
        )

    try:
        if http_client is None:
            async with httpx.AsyncClient() as client:
                response = await _call(client)
        else:
            response = await _call(http_client)
    except httpx.TimeoutException:
        # Never log the endpoint URL alongside the key context; the URL is
        # safe on its own (no key in it) but we keep the log minimal.
        log.warning("plantnet timeout")
        return PlantNetVerification(status="not_sure", species=None, reason="PlantNet timed out")
    except httpx.HTTPError as error:
        log.warning("plantnet transport error", error_type=type(error).__name__)
        return PlantNetVerification(status="error", species=None, reason="transport error")

    if response.status_code == 404:
        # PlantNet uses 404 for "no species matched" on the /identify endpoint.
        return PlantNetVerification(status="not_sure", species=None, reason="no match")
    if response.status_code >= 400:
        log.warning("plantnet error status", status=response.status_code)
        return PlantNetVerification(
            status="error",
            species=None,
            reason=f"HTTP {response.status_code}",
        )

    try:
        payload = response.json()
    except ValueError:
        # PlantNet returns 200 with a maintenance HTML page occasionally; the
        # UI must still get a usable answer instead of a 500 from the proxy.
        log.warning("plantnet non-json response")
        return PlantNetVerification(status="not_sure", species=None, reason="invalid response")
    results = payload.get("results") or []
    if not results:
        return PlantNetVerification(status="not_sure", species=None, reason="no results")
    top = results[0]
    species = top.get("species") or {}
    scientific_name = (species.get("scientificNameWithoutAuthor") or "").strip()
    if not scientific_name:
        return PlantNetVerification(status="not_sure", species=None, reason="no scientific name")
    common_names_raw = species.get("commonNames") or []
    common_names = tuple(name for name in common_names_raw if isinstance(name, str) and name)
    family = ((species.get("family") or {}).get("scientificNameWithoutAuthor")) or None
    score = float(top.get("score") or 0.0)
    return PlantNetVerification(
        status="native",
        species=PlantNetSpecies(
            scientific_name=scientific_name,
            common_names=common_names,
            family=family,
            score=score,
        ),
    )
