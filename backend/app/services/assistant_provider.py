"""Bounded Gemini project failover, then Groq, inside the existing role deadline."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from functools import lru_cache
from hashlib import sha256
from threading import Lock
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from app.config import Settings

Role = Literal["judge", "generation", "grounding", "general_knowledge"]
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
FAILOVER_STATUSES = frozenset({429, 500, 502, 503, 504})
# Capability selection only; these IDs are never selected as a default model.
# https://console.groq.com/docs/structured-outputs (verified 2026-10-07)
STRICT_SCHEMA_MODELS = frozenset({"openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"})
BEST_EFFORT_SCHEMA_MODELS = frozenset({"openai/gpt-oss-safeguard-20b"})
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Result:
    payload: object = field(default=None, repr=False)
    failure: str | None = None
    status: int | None = None
    eligible: bool = False
    retry_after_seconds: float | None = None


def _configured_keys(settings: Settings) -> tuple[str, ...]:
    values = (
        settings.assistant_generation_key,
        settings.assistant_generation_key_2,
        settings.assistant_generation_key_3,
        settings.assistant_generation_key_4,
        settings.assistant_generation_key_5,
    )
    return tuple(
        dict.fromkeys(
            k.get_secret_value().strip() for k in values if k and k.get_secret_value().strip()
        )
    )


@dataclass
class _QuotaState:
    """Process-local state shared by roles; no credentials or provider bodies."""

    cursor: int = 0
    blocked_until: dict[int, float] = field(default_factory=dict)
    lock: Lock = field(default_factory=Lock, repr=False)

    def select(self, count: int, tried: set[int]) -> int | None:
        with self.lock:
            now = time.monotonic()
            for offset in range(count):
                index = (self.cursor + offset) % count
                if index not in tried and self.blocked_until.get(index, 0) <= now:
                    self.cursor = index
                    return index
        return None

    def limited(self, index: int, count: int, delay: float) -> None:
        with self.lock:
            self.blocked_until[index] = max(
                self.blocked_until.get(index, 0), time.monotonic() + delay
            )
            if self.cursor == index:
                self.cursor = (index + 1) % count


@lru_cache(maxsize=32)
def _quota_state(identities: tuple[bytes, ...], model: str) -> _QuotaState:
    # Cache identities are one-way digests; the state never stores secret values.
    return _QuotaState()


def _daily_reset_delay() -> float:
    try:
        now = datetime.now(ZoneInfo("America/Los_Angeles"))
    except ZoneInfoNotFoundError:
        # A minimal runtime without time-zone data must not retry a daily quota
        # early or fail the request while handling an otherwise ordinary 429.
        return 25 * 60 * 60
    reset = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return (reset.astimezone(UTC) - now.astimezone(UTC)).total_seconds()


def _quota_delay(response: httpx.Response) -> float:
    """Read only bounded retry/quota metadata; never retain or log the error body."""
    delays = [60.0]
    header = response.headers.get("retry-after", "")
    try:
        if re.fullmatch(r"\d+(?:\.\d+)?", header):
            delays.append(float(header))
        elif header:
            reset = parsedate_to_datetime(header)
            if reset.tzinfo is not None:
                delays.append((reset - datetime.now(UTC)).total_seconds())
    except (ValueError, OverflowError):
        pass
    try:
        if len(response.content) <= 64 * 1024:
            body = response.json()
            details = body.get("error", {}).get("details", [])
            if isinstance(details, list):
                for detail in details:
                    if not isinstance(detail, dict):
                        continue
                    if detail.get("@type") == "type.googleapis.com/google.rpc.RetryInfo":
                        match = re.fullmatch(r"(\d+(?:\.\d+)?)s", str(detail.get("retryDelay", "")))
                        if match:
                            delays.append(float(match[1]))
                    if detail.get("@type") == "type.googleapis.com/google.rpc.QuotaFailure":
                        violations = detail.get("violations", [])
                        if isinstance(violations, list) and any(
                            isinstance(v, dict)
                            and re.search(
                                r"per.?day|daily",
                                str(v.get("quotaMetric", "")) + str(v.get("quotaId", "")),
                                re.I,
                            )
                            for v in violations
                        ):
                            delays.append(_daily_reset_delay())
    except (ValueError, TypeError, AttributeError, OverflowError):
        pass
    return max(delay for delay in delays if math.isfinite(delay))


def _model_is_key(model: str, settings: Settings) -> bool:
    return model in _configured_keys(settings) or bool(
        settings.groq_api_key and model == settings.groq_api_key.get_secret_value().strip()
    )


def groq_ready(settings: Settings) -> bool:
    return bool(
        settings.groq_fallback_enabled
        and settings.groq_api_key
        and settings.groq_api_key.get_secret_value().strip()
        and settings.groq_model
        and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}", settings.groq_model)
        and not _model_is_key(settings.groq_model, settings)
    )


def groq_payload(payload: dict, model: str, role: Role) -> dict:
    """Translate only existing role instructions/context/schema, never request metadata."""
    config = payload["generationConfig"]
    schema = config["responseJsonSchema"]
    policy = payload["systemInstruction"]["parts"][0]["text"]
    if model in STRICT_SCHEMA_MODELS or model in BEST_EFFORT_SCHEMA_MODELS:
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": f"plant_assistant_{role}",
                "strict": model in STRICT_SCHEMA_MODELS,
                "schema": schema,
            },
        }
    else:
        response_format = {"type": "json_object"}
        policy += " Return only a JSON object matching this JSON Schema: " + json.dumps(schema)
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": policy},
            {"role": "user", "content": payload["contents"][0]["parts"][0]["text"]},
        ],
        "temperature": config["temperature"],
        "max_completion_tokens": config["maxOutputTokens"],
        "response_format": response_format,
        "stream": False,
    }


async def _request(url: str, headers: dict, payload: dict, timeout: float, provider: str) -> Result:
    if timeout <= 0:
        return Result(failure="deadline_exhausted")
    status = None
    try:
        async with (
            asyncio.timeout(timeout),
            httpx.AsyncClient(timeout=timeout, trust_env=False) as client,
        ):
            response = await client.post(url, headers=headers, json=payload)
            status = response.status_code
            if status != 200:
                return Result(
                    failure=f"http_{status}",
                    status=status,
                    eligible=status in FAILOVER_STATUSES,
                    retry_after_seconds=_quota_delay(response) if status == 429 else None,
                )
            if len(response.content) > 64 * 1024:
                return Result(failure="invalid_response", status=status)
            body = response.json()
            if provider == "gemini":
                if isinstance(body, dict) and isinstance(body.get("error"), dict):
                    if body["error"].get("status") == "RESOURCE_EXHAUSTED":
                        return Result(
                            failure="quota_exhausted",
                            status=status,
                            eligible=True,
                            retry_after_seconds=_quota_delay(response),
                        )
                    return Result(failure="invalid_response", status=status)
                candidates = body["candidates"]
                if (
                    not isinstance(candidates, list)
                    or len(candidates) != 1
                    or candidates[0].get("finishReason") != "STOP"
                ):
                    return Result(failure="invalid_response", status=status)
                text = "".join(
                    p.get("text", "")
                    for p in candidates[0]["content"]["parts"]
                    if not p.get("thought")
                )
            else:
                choices = body["choices"]
                if (
                    not isinstance(choices, list)
                    or len(choices) != 1
                    or choices[0].get("finish_reason") != "stop"
                ):
                    return Result(failure="invalid_response", status=status)
                message = choices[0]["message"]
                if message.get("refusal") or message.get("tool_calls"):
                    return Result(failure="invalid_response", status=status)
                text = message["content"]
            if not isinstance(text, str) or not text.strip():
                return Result(failure="invalid_response", status=status)
            return Result(payload=json.loads(text), status=status)
    except (TimeoutError, httpx.TimeoutException):
        return Result(failure="timeout", eligible=True)
    except httpx.TransportError:
        return Result(failure="network", eligible=True)
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        # Successful but invalid content is not permission to seek a second opinion.
        return Result(failure="invalid_response", status=status)
    except httpx.HTTPError:
        return Result(failure="request_error")


def _record(role: Role, provider: str, model: str, result: Result, elapsed: float) -> None:
    # Fixed categories only: no payload, exception/body text, headers, IDs or keys.
    log = logger.warning if result.failure else logger.info
    log(
        "assistant.provider phase=%s provider=%s model=%s result=%s status=%s latency_ms=%d",
        role,
        provider,
        model,
        result.failure or "response",
        result.status,
        round(elapsed * 1000),
    )


async def complete(
    payload: dict,
    model: str,
    role: Role,
    timeout: float,
    settings: Settings,
    *,
    allow_fallback: bool = True,
) -> object | None:
    """Semantic results/validation failures never route to a different provider."""
    if (
        not settings.assistant_generation_key
        or not settings.assistant_generation_key.get_secret_value().strip()
        or not isinstance(model, str)
        or not re.fullmatch(r"[a-zA-Z0-9.-]{1,100}", model)
        or _model_is_key(model, settings)
        or timeout <= 0
    ):
        return None
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    fallback = allow_fallback and groq_ready(settings)
    try:
        secondary_payload = groq_payload(payload, settings.groq_model, role) if fallback else None
    except (ValueError, KeyError, TypeError, AttributeError):
        return None
    # Reserve time for timeout failover, rather than exceeding the role/shared cap.
    primary_budget = timeout / 2 if fallback else timeout
    primary_deadline = min(deadline, loop.time() + primary_budget)
    keys = (
        _configured_keys(settings)
        if (settings.gemini_key_pool_enabled and settings.assistant_generation_free_tier)
        else (settings.assistant_generation_key.get_secret_value().strip(),)
    )
    state = (
        _quota_state(tuple(sha256(k.encode()).digest() for k in keys), model)
        if len(keys) > 1
        else None
    )
    tried: set[int] = set()
    primary = Result(failure="quota_exhausted", eligible=True)
    for _ in range(len(keys) if allow_fallback else 1):
        index = state.select(len(keys), tried) if state else 0
        if index is None:
            break
        remaining = primary_deadline - loop.time() if state else primary_budget
        if remaining <= 0:
            break
        tried.add(index)
        start = loop.time()
        primary = await _request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            {"x-goog-api-key": keys[index]},
            payload,
            remaining,
            "gemini",
        )
        _record(role, "gemini", model, primary, loop.time() - start)
        if primary.failure is None:
            return primary.payload
        if state and (primary.status == 429 or primary.failure == "quota_exhausted"):
            state.limited(index, len(keys), primary.retry_after_seconds or 60.0)
            continue
        # Only a quota failure permits another Gemini project. Content failures
        # remain terminal, and ordinary outages retain the existing Groq route.
        break
    if not primary.eligible or not fallback:
        return None
    remaining = deadline - loop.time()
    if remaining <= 0:
        return None
    start = loop.time()
    secondary = await _request(
        f"{GROQ_BASE_URL}/chat/completions",
        {"Authorization": f"Bearer {settings.groq_api_key.get_secret_value()}"},
        secondary_payload,
        remaining,
        "groq",
    )
    _record(role, "groq", settings.groq_model, secondary, loop.time() - start)
    return secondary.payload if secondary.failure is None else None
