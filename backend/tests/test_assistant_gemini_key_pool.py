"""Controlled key/project failover. Every HTTP request uses MockTransport."""

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from hashlib import sha256
from types import SimpleNamespace

import httpx
import pytest

from app.config import Settings
from app.services import assistant_provider as provider

KEYS = tuple(f"project-{i}-test-secret" for i in range(1, 6))
PAYLOAD = {
    "systemInstruction": {"parts": [{"text": "Bounded botanical instructions"}]},
    "contents": [{"parts": [{"text": '{"question":"What is a rhizome?"}'}]}],
    "generationConfig": {
        "responseJsonSchema": {"type": "object"},
        "temperature": 0,
        "maxOutputTokens": 100,
    },
}


@pytest.fixture(autouse=True)
def isolated_pool():
    provider._quota_state.cache_clear()
    yield
    provider._quota_state.cache_clear()


def settings(**overrides):
    values = {
        "_env_file": None,
        "assistant_generation_key": KEYS[0],
        **{f"assistant_generation_key_{i}": KEYS[i - 1] for i in range(2, 6)},
        "gemini_key_pool_enabled": True,
        "assistant_generation_free_tier": True,
        "groq_fallback_enabled": True,
        "groq_api_key": "groq-test-secret",
        "groq_model": "test-groq",
    }
    return Settings(**(values | overrides))


def success(groq=False):
    text = json.dumps({"accepted": True})
    body = (
        {"choices": [{"finish_reason": "stop", "message": {"content": text}}]}
        if groq
        else {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": text}]}}]}
    )
    return httpx.Response(200, json=body)


def install(monkeypatch, handler):
    calls = []
    original = httpx.AsyncClient

    async def transport(request):
        calls.append(request)
        result = handler(request)
        return await result if asyncio.iscoroutine(result) else result

    monkeypatch.setattr(
        provider.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(transport), **kw),
    )
    return calls


def run(s=None, role="generation", **kw):
    return asyncio.run(provider.complete(PAYLOAD, "test-gemini", role, 1, s or settings(), **kw))


def credentials(calls):
    return [req.headers.get("x-goog-api-key", "groq") for req in calls]


@pytest.mark.parametrize("role", ["judge", "generation", "grounding", "general_knowledge"])
def test_quota_switch_preserves_model_payload_and_role(monkeypatch, role):
    calls = install(
        monkeypatch,
        lambda r: httpx.Response(429) if r.headers.get("x-goog-api-key") == KEYS[0] else success(),
    )
    assert run(role=role) == {"accepted": True}
    assert credentials(calls) == list(KEYS[:2])
    assert all(json.loads(r.content) == PAYLOAD for r in calls)
    assert all(r.url.path.endswith("test-gemini:generateContent") for r in calls)


def test_next_question_and_other_roles_keep_working_key(monkeypatch):
    calls = install(
        monkeypatch,
        lambda r: httpx.Response(429) if r.headers.get("x-goog-api-key") in KEYS[:2] else success(),
    )
    s = settings()
    assert run(s) == {"accepted": True}
    assert run(s, "grounding") == {"accepted": True}
    assert run(s, "judge") == {"accepted": True}
    assert credentials(calls) == [KEYS[0], KEYS[1], KEYS[2], KEYS[2], KEYS[2]]


def test_five_exhausted_projects_try_groq_once_then_skip_cooled_projects(monkeypatch):
    calls = install(
        monkeypatch,
        lambda r: httpx.Response(429) if "x-goog-api-key" in r.headers else success(groq=True),
    )
    assert run() == {"accepted": True}
    assert credentials(calls) == [*KEYS, "groq"]
    assert run(role="grounding") == {"accepted": True}
    assert credentials(calls) == [*KEYS, "groq", "groq"]


def test_all_providers_unavailable_are_bounded(monkeypatch):
    calls = install(monkeypatch, lambda r: httpx.Response(429))
    assert run() is None
    assert credentials(calls) == [*KEYS, "groq"]
    assert run() is None
    assert credentials(calls) == [*KEYS, "groq", "groq"]


def test_blank_duplicate_keys_do_not_add_requests(monkeypatch):
    s = settings(
        assistant_generation_key_2=" ",
        assistant_generation_key_3=KEYS[0],
        assistant_generation_key_4=None,
        assistant_generation_key_5=KEYS[4],
    )
    calls = install(monkeypatch, lambda r: httpx.Response(429))
    assert run(s) is None
    assert credentials(calls) == [KEYS[0], KEYS[4], "groq"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"gemini_key_pool_enabled": False},
        {"assistant_generation_free_tier": False},
    ],
)
def test_backup_keys_require_opt_in_and_free_project_acknowledgement(monkeypatch, overrides):
    calls = install(monkeypatch, lambda r: httpx.Response(429))
    assert run(settings(**overrides)) is None
    assert credentials(calls) == [KEYS[0], "groq"]


def test_missing_primary_does_not_silently_enable_backups(monkeypatch):
    calls = install(monkeypatch, lambda r: success())
    assert run(settings(assistant_generation_key=None)) is None
    assert calls == []


def test_allow_fallback_false_allows_only_one_inference(monkeypatch):
    calls = install(monkeypatch, lambda r: httpx.Response(429))
    assert run(allow_fallback=False) is None
    assert credentials(calls) == [KEYS[0]]


@pytest.mark.parametrize("failure", [400, 401, 403, "malformed", "blocked", "empty"])
def test_content_and_configuration_failures_never_rotate(monkeypatch, failure):
    def handler(r):
        if isinstance(failure, int):
            return httpx.Response(failure)
        if failure == "malformed":
            return httpx.Response(200, text="invalid")
        return httpx.Response(
            200,
            json={"candidates": []}
            if failure == "empty"
            else {
                "candidates": [{"finishReason": "SAFETY", "content": {"parts": []}}],
            },
        )

    calls = install(monkeypatch, handler)
    assert run() is None
    assert credentials(calls) == [KEYS[0]]


@pytest.mark.parametrize("failure", [500, 502, 503, 504, "timeout", "network"])
def test_non_quota_outage_preserves_direct_groq_failover(monkeypatch, failure):
    def handler(r):
        if "x-goog-api-key" not in r.headers:
            return success(groq=True)
        if failure == "timeout":
            raise httpx.ReadTimeout("controlled")
        if failure == "network":
            raise httpx.ConnectError("controlled")
        return httpx.Response(failure)

    calls = install(monkeypatch, handler)
    assert run() == {"accepted": True}
    assert credentials(calls) == [KEYS[0], "groq"]


def test_successful_http_resource_exhausted_rotates(monkeypatch):
    calls = install(
        monkeypatch,
        lambda r: (
            httpx.Response(200, json={"error": {"status": "RESOURCE_EXHAUSTED"}})
            if r.headers.get("x-goog-api-key") == KEYS[0]
            else success()
        ),
    )
    assert run() == {"accepted": True}
    assert credentials(calls) == list(KEYS[:2])


def test_retry_metadata_is_respected_without_logging_body(monkeypatch, caplog):
    details = [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "240s"}]
    calls = install(
        monkeypatch,
        lambda r: httpx.Response(
            429,
            headers={"Retry-After": "120"},
            json={"error": {"message": "private-provider-error", "details": details}},
        ),
    )
    with caplog.at_level(logging.INFO, logger=provider.__name__):
        assert run() is None
    state = provider._quota_state(tuple(sha256(k.encode()).digest() for k in KEYS), "test-gemini")
    assert state.blocked_until[0] - provider.time.monotonic() > 238
    assert "private-provider-error" not in caplog.text
    assert not any(k in caplog.text for k in (*KEYS, "groq-test-secret"))
    assert not any(k in str(calls[0].url) for k in KEYS)


@pytest.mark.parametrize("body", [None, [], {"error": []}, {"error": {"details": "bad"}}])
def test_malformed_quota_metadata_is_not_an_unhandled_exception(body):
    assert provider._quota_delay(httpx.Response(429, json=body)) == 60


def test_daily_quota_waits_until_pacific_reset(monkeypatch):
    assert 0 < provider._daily_reset_delay() <= 90000
    monkeypatch.setattr(provider, "_daily_reset_delay", lambda: 7000)
    body = {
        "error": {
            "details": [
                {
                    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                    "violations": [
                        {"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}
                    ],
                }
            ]
        }
    }
    assert provider._quota_delay(httpx.Response(429, json=body)) == 7000


def test_retry_after_http_date_and_invalid_values():
    header = format_datetime(datetime.now(UTC) + timedelta(minutes=5), usegmt=True)
    delay = provider._quota_delay(httpx.Response(429, headers={"Retry-After": header}))
    assert 298 < delay <= 300
    for invalid in ["invalid", "nan", "inf", "-50", "9" * 1000]:
        assert provider._quota_delay(httpx.Response(429, headers={"Retry-After": invalid})) == 60


def test_cooldown_expires_and_model_pools_are_independent(monkeypatch):
    monkeypatch.setattr(provider.time, "monotonic", lambda: 100)
    state = provider._quota_state((b"first", b"second"), "model-one")
    state.limited(0, 2, 120)
    state.limited(1, 2, 120)
    assert state.select(2, set()) is None
    assert provider._quota_state((b"first", b"second"), "model-two").select(2, set()) == 0
    monkeypatch.setattr(provider.time, "monotonic", lambda: 220)
    assert state.select(2, set()) == 0
    assert state.select(2, {0}) == 1


def test_remaining_time_not_fresh_timeout_for_each_key(monkeypatch):
    # Test budget accounting with a controlled adapter clock. Real 40ms sleeps
    # can consume a 60ms budget before the second key on Windows schedulers.
    timeouts = []
    calls = []
    clock = [0.0]

    async def request(url, headers, payload, timeout, provider_name):
        calls.append(httpx.Request("POST", url, headers=headers))
        timeouts.append(timeout)
        clock[0] += min(0.04, timeout)
        if timeout < 0.04:
            return provider.Result(failure="timeout", eligible=True)
        return provider.Result(failure="quota_exhausted", status=429, eligible=True)

    monkeypatch.setattr(provider, "_request", request)
    monkeypatch.setattr(
        provider,
        "asyncio",
        SimpleNamespace(get_running_loop=lambda: SimpleNamespace(time=lambda: clock[0])),
    )

    async def bounded():
        start = clock[0]
        result = await provider.complete(PAYLOAD, "test-gemini", "generation", 0.12, settings())
        return result, clock[0] - start

    result, elapsed = asyncio.run(bounded())
    assert result is None and elapsed < 0.25
    assert credentials(calls) == [KEYS[0], KEYS[1], "groq"]
    assert 0 < timeouts[1] < timeouts[0] <= 0.06


@pytest.mark.parametrize("role", ["judge", "generation", "grounding", "general_knowledge"])
def test_backup_secret_cannot_be_used_as_model_or_logged(monkeypatch, role, caplog):
    calls = install(monkeypatch, lambda r: success())
    with caplog.at_level(logging.INFO, logger=provider.__name__):
        assert asyncio.run(provider.complete(PAYLOAD, KEYS[3], role, 1, settings())) is None
    assert calls == [] and KEYS[3] not in caplog.text
    assert not provider.groq_ready(settings(groq_model=KEYS[4]))


def test_dotenv_loads_five_masked_secret_fields(tmp_path):
    env = tmp_path / ".env"
    env.write_text(
        "\n".join(
            [f"GEMINI_API_KEY{f'_{i}' if i > 1 else ''}={KEYS[i - 1]}" for i in range(1, 6)]
            + ["GEMINI_KEY_POOL_ENABLED=true", "ASSISTANT_GENERATION_FREE_TIER=true"]
        )
    )
    s = Settings(_env_file=env)
    assert s.gemini_key_pool_enabled
    assert provider._configured_keys(s) == KEYS
    assert not any(k in repr(s) for k in KEYS)


def test_minimal_runtime_without_timezone_data_has_safe_daily_cooldown(monkeypatch):
    def unavailable(_):
        raise provider.ZoneInfoNotFoundError("controlled")

    monkeypatch.setattr(provider, "ZoneInfo", unavailable)
    assert provider._daily_reset_delay() == 90000
