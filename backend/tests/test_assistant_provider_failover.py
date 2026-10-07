"""F01–F16 real adapters/router with bounded controlled HTTP (zero external calls)."""

import asyncio
import json
import logging
import time

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers import plant_assistant as router
from app.config import Settings, get_settings
from app.core.rate_limit import rate_limiter
from app.domain.plant_assistant import get_retriever, protected_chunks
from app.services import assistant_generation as generation
from app.services import assistant_grounding as grounding
from app.services import assistant_judge as judge
from app.services import assistant_provider as provider

SPECIES = "Acacia auriculiformis"
QUESTION = "Are its pods twisted?"


def chunks(species="acacia-auriculiformis", topic="identification"):
    return [next(c for c in get_retriever().chunks if c["chunk_id"] == f"CAT-{species}-{topic}")]


def config(**kw):
    return Settings(
        _env_file=None,
        assistant_judge_enabled=True,
        assistant_generation_enabled=True,
        assistant_generation_free_tier=True,
        assistant_generation_key="primary-test-secret",
        assistant_judge_model="test-primary",
        assistant_generation_model="test-primary",
        groq_fallback_enabled=True,
        groq_api_key="secondary-test-secret",
        groq_model="test-secondary",
        **kw,
    )


def verdict(species, sentences, evidence, ids):
    return {
        "decision": "supported",
        "species": species,
        "claims": [
            {
                "sentence_index": n,
                "supported": True,
                "supporting_chunk_ids": ids,
                "evidence_quotes": [
                    {"chunk_id": c["chunk_id"], "quote": c["content"]} for c in evidence
                ],
            }
            for n in range(len(sentences))
        ],
    }


def valid_output(role, context):
    evidence = context["evidence"]
    species = context["species"]
    ids = [c["chunk_id"] for c in evidence]
    if role == "judge":
        return {
            "decision": "supported",
            "species": species,
            "supporting_chunk_ids": ids,
            "aspect_support": [
                {
                    "aspect": a,
                    "supporting_chunk_ids": ids,
                    "evidence_quotes": [c["content"] for c in evidence],
                }
                for a in context["aspects"]
            ],
        }
    if role == "generation":
        sentence = "Its pods are twisted." if species == SPECIES else "It grows along riverbanks."
        return {
            "status": "answer",
            "species": species,
            "sentences": [sentence],
            "used_chunk_ids": ids,
        }
    return verdict(species, context["sentences"], evidence, context["used_chunk_ids"])


def decoded(request):
    body = json.loads(request.content)
    primary = request.url.host == "generativelanguage.googleapis.com"
    context = json.loads(
        body["contents"][0]["parts"][0]["text"] if primary else body["messages"][1]["content"]
    )
    role = (
        "grounding" if "sentences" in context else "generation" if "depth" in context else "judge"
    )
    return ("gemini" if primary else "groq"), role, context, body


def response(name, output):
    if name == "gemini":
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {
                            "parts": [
                                {"thought": True, "text": "ignored"},
                                {"text": json.dumps(output)},
                            ]
                        },
                    }
                ]
            },
        )
    return httpx.Response(
        200,
        json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(output)}}]},
    )


def inject(monkeypatch, handler):
    seen = []

    def transport(request):
        item = decoded(request)
        seen.append(item)
        return handler(*item, request)

    original = httpx.AsyncClient
    monkeypatch.setattr(
        provider.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(transport), **kw),
    )
    return seen


def invoke(role, settings):
    e = chunks()
    ids = [c["chunk_id"] for c in e]
    if role == "judge":
        return asyncio.run(judge.evaluate(QUESTION, SPECIES, e, settings))
    if role == "generation":
        return asyncio.run(generation.generate(QUESTION, SPECIES, e, "standard", settings))
    return asyncio.run(
        grounding.verify_grounding(SPECIES, ["Its pods are twisted."], e, ids, settings)
    )


def client(settings, monkeypatch):
    a = FastAPI()
    a.include_router(router.router)
    a.dependency_overrides[get_settings] = lambda: settings
    monkeypatch.setattr(rate_limiter, "enabled", False)
    return TestClient(a)


def post(c, q=QUESTION, species="acacia-auriculiformis", **kw):
    return c.post(
        "/api/v1/plant-assistant/ask",
        json={"question": q, "speciesId": species, "classifierConfidence": 0.95, **kw},
    ).json()


@pytest.mark.parametrize("role", ["judge", "generation", "grounding"])
def test_F01_primary_success_no_secondary(monkeypatch, role):
    seen = inject(
        monkeypatch, lambda name, role, ctx, body, req: response(name, valid_output(role, ctx))
    )
    assert invoke(role, config()) is not None
    assert [x[0] for x in seen] == ["gemini"]


@pytest.mark.parametrize("role", ["judge", "generation", "grounding"])
@pytest.mark.parametrize(
    "failure", [429, 500, 502, 503, 504, "timeout", "network", "resource_exhausted"]
)
def test_F02_F03_F04_allowed_failure_routes_exactly_once(monkeypatch, role, failure):
    def handler(name, role, ctx, body, req):
        if name == "gemini":
            if failure == "timeout":
                raise httpx.ReadTimeout("controlled")
            if failure == "network":
                raise httpx.ConnectError("controlled")
            if failure == "resource_exhausted":
                return httpx.Response(200, json={"error": {"status": "RESOURCE_EXHAUSTED"}})
            return httpx.Response(
                failure,
                json={
                    "error": {"status": "RESOURCE_EXHAUSTED" if failure == 429 else "UNAVAILABLE"}
                },
            )
        return response(name, valid_output(role, ctx))

    seen = inject(monkeypatch, handler)
    assert invoke(role, config()) is not None
    assert [x[0] for x in seen] == ["gemini", "groq"]
    assert seen[0][2] == seen[1][2]
    assert seen[1][3]["model"] == "test-secondary"


@pytest.mark.parametrize("role", ["judge", "grounding"])
@pytest.mark.parametrize("decision", ["unsupported", "uncertain"])
def test_F05_F06_semantic_result_never_overturned(monkeypatch, role, decision):
    def handler(name, role, ctx, body, req):
        out = valid_output(role, ctx)
        out["decision"] = decision
        return response(name, out)

    seen = inject(monkeypatch, handler)
    out = invoke(role, config())
    assert out["decision"] == decision and len(seen) == 1


@pytest.mark.parametrize("role", ["judge", "generation", "grounding"])
@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_F07_configuration_and_request_errors_never_masked(monkeypatch, role, status):
    seen = inject(
        monkeypatch,
        lambda *args: httpx.Response(status, json={"error": {"status": "RESOURCE_EXHAUSTED"}}),
    )
    assert invoke(role, config()) is None and len(seen) == 1


@pytest.mark.parametrize("role", ["judge", "generation", "grounding"])
@pytest.mark.parametrize(
    "secondary", [400, 401, 403, 429, 498, 503, "network", "timeout", "malformed"]
)
def test_F08_both_fail_preserves_router_outcome(monkeypatch, role, secondary):
    def handler(name, current_role, ctx, body, req):
        if current_role != role:
            return response(name, valid_output(current_role, ctx))
        if name == "gemini":
            return httpx.Response(429)
        if secondary == "network":
            raise httpx.ConnectError("controlled")
        if secondary == "timeout":
            raise httpx.ReadTimeout("controlled")
        if secondary == "malformed":
            return httpx.Response(
                200,
                json={"choices": [{"finish_reason": "stop", "message": {"content": "not JSON"}}]},
            )
        return httpx.Response(secondary)

    seen = inject(monkeypatch, handler)
    with client(config(), monkeypatch) as c:
        out = post(c)
    assert out["status"] == ("insufficient_evidence" if role == "judge" else "fallback")
    assert len([x for x in seen if x[0] == "groq"]) == 1
    assert all(x[0] in {"gemini", "groq"} for x in seen)
    if role == "judge":
        assert all(x[1] == "judge" for x in seen)
    else:
        assert out["answer"] == chunks()[0]["content"]


@pytest.mark.parametrize(
    "q,species,extra",
    [
        ("Can I remove it?", "mikania-micrantha", {}),
        ("Does it grow near me?", "mikania-micrantha", {}),
        ("What disease does it cure?", "mikania-micrantha", {}),
        ("When does it flower?", "mikania-micrantha", {}),
        ("Where does it grow?", "unknown", {}),
        ("Where does it grow?", "mikania-micrantha", {"classifierOutcome": "other_plant"}),
        ("Where does it grow?", "mikania-micrantha", {"classifierOutcome": "uncertain"}),
        ("Where does it grow?", "mikania-micrantha", {"classifierConfidence": 0.1}),
        ("Is it safe to touch?", "asclepias-curassavica", {}),
        ("Can I leave stem pieces on damp ground?", "mikania-micrantha", {}),
    ],
)
def test_F09_F10_guards_protected_and_scan_bypass_both(monkeypatch, q, species, extra):
    monkeypatch.setattr(
        provider.httpx, "AsyncClient", lambda **kw: pytest.fail("Providers must be bypassed")
    )
    with client(config(), monkeypatch) as c:
        out = post(c, q, species, **extra)
    assert out["status"] in {"fallback", "insufficient_evidence", "unsupported_scan"}


def test_F11_F16_groq_generated_candidate_requires_grounding_and_backend_sources(monkeypatch):
    def handler(name, role, ctx, body, req):
        if name == "gemini" and role == "generation":
            return httpx.Response(429)
        return response(name, valid_output(role, ctx))

    seen = inject(monkeypatch, handler)
    with client(config(), monkeypatch) as c:
        out = post(c)
    assert out["status"] == "answer" and out["answer"] == "Its pods are twisted."
    assert [(x[0], x[1]) for x in seen] == [
        ("gemini", "judge"),
        ("gemini", "generation"),
        ("groq", "generation"),
        ("gemini", "grounding"),
    ]
    assert {(x["sourceName"], x["sourceUrl"]) for x in out["sources"]} == {
        (s["title"], s["url"]) for s in chunks()[0]["sources"]
    }


@pytest.mark.parametrize(
    "sentence",
    [
        "Its leaves are purple.",
        "Its flowers open in October.",
        "Its flowers appear every week.",
        "Its main feature is white flower heads.",
        "Its stem ribs cause its leaf shape.",
        "It grows in every Malaysian garden.",
    ],
)
def test_F12_F15_groq_candidate_and_grounding_reject_unsupported_claim(monkeypatch, sentence):
    def handler(name, role, ctx, body, req):
        if name == "gemini":
            return httpx.Response(429)
        if role == "generation":
            p = valid_output(role, ctx)
            p["sentences"] = [sentence]
            return response(name, p)
        p = valid_output(role, ctx)
        p["decision"] = "unsupported"
        p["claims"] = []
        return response(name, p)

    seen = inject(monkeypatch, handler)
    with client(config(), monkeypatch) as c:
        out = post(c, "Explain the scan result", "mikania-micrantha")
    assert out["status"] == "fallback" and sentence not in out["answer"]
    assert [(x[0], x[1]) for x in seen] == [
        ("gemini", "generation"),
        ("groq", "generation"),
        ("gemini", "grounding"),
        ("groq", "grounding"),
    ]


@pytest.mark.parametrize(
    "q,decision", [(QUESTION, "supported"), ("Are its flower spikes curved?", "unsupported")]
)
def test_F13_F14_groq_relation_obeys_contract(monkeypatch, q, decision):
    def handler(name, role, ctx, body, req):
        if name == "gemini" and role == "judge":
            return httpx.Response(429)
        p = valid_output(role, ctx)
        if role == "judge" and decision != "supported":
            p.update(decision=decision, supporting_chunk_ids=[], aspect_support=[])
        return response(name, p)

    seen = inject(monkeypatch, handler)
    with client(config(), monkeypatch) as c:
        out = post(c, q)
    assert out["status"] == ("answer" if decision == "supported" else "insufficient_evidence")
    assert len([x for x in seen if x[0] == "groq"]) == 1
    if decision == "unsupported":
        assert all(x[1] == "judge" for x in seen)


@pytest.mark.parametrize(
    "extra", [{"source_url": "https://invented.example"}, {"answer": "extra prose"}]
)
def test_F16_groq_cannot_supply_arbitrary_sources(monkeypatch, extra):
    def handler(name, role, ctx, body, req):
        if name == "gemini" and role == "generation":
            return httpx.Response(429)
        p = valid_output(role, ctx)
        if role == "generation":
            p.update(extra)
        return response(name, p)

    seen = inject(monkeypatch, handler)
    with client(config(), monkeypatch) as c:
        out = post(c)
    assert out["status"] == "fallback" and all(
        "invented.example" not in s["sourceUrl"] for s in out["sources"]
    )
    assert not any(x[1] == "grounding" for x in seen)


@pytest.mark.parametrize(
    "model,kind,strict",
    [
        ("openai/gpt-oss-20b", "json_schema", True),
        ("openai/gpt-oss-120b", "json_schema", True),
        ("qwen/qwen3.8-27b", "json_schema", True),
        ("openai/gpt-oss-safeguard-20b", "json_schema", False),
        ("some-approved-model", "json_object", None),
    ],
)
def test_strongest_documented_mode_preserves_schema_and_context(model, kind, strict):
    p = grounding.provider_payload(
        SPECIES, ["Its pods are twisted."], chunks(), [chunks()[0]["chunk_id"]]
    )
    g = provider.groq_payload(p, model, "grounding")
    assert g["response_format"]["type"] == kind
    assert g["messages"][1]["content"] == p["contents"][0]["parts"][0]["text"]
    if strict is not None:
        assert g["response_format"]["json_schema"]["strict"] == strict
        assert (
            g["response_format"]["json_schema"]["schema"]
            == p["generationConfig"]["responseJsonSchema"]
        )
    else:
        assert (
            json.dumps(p["generationConfig"]["responseJsonSchema"]) in g["messages"][0]["content"]
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("groq_api_key", None),
        ("groq_api_key", ""),
        ("groq_model", None),
        ("groq_model", ""),
        ("groq_model", "invalid model"),
        ("groq_fallback_enabled", False),
        ("assistant_generation_key", None),
        ("assistant_generation_key", ""),
    ],
)
def test_incomplete_configuration_disables_fallback(monkeypatch, field, value):
    from pydantic import SecretStr

    s = config()
    setattr(s, field, SecretStr(value) if field.endswith("key") and value is not None else value)
    seen = inject(monkeypatch, lambda *args: httpx.Response(429))
    assert invoke("grounding", s) is None
    assert all(x[0] == "gemini" for x in seen)
    if field == "assistant_generation_key":
        assert not seen


@pytest.mark.parametrize("role", ["judge", "generation", "grounding"])
@pytest.mark.parametrize("bad", ["not_json", "schema", "extra_candidate", "truncated"])
def test_primary_invalid_content_terminal_not_a_second_opinion(monkeypatch, role, bad):
    def handler(name, role, ctx, body, req):
        if bad == "schema":
            return response(name, {"unexpected": "invalid"})
        p = {
            "candidates": [
                {
                    "finishReason": "MAX_TOKENS" if bad == "truncated" else "STOP",
                    "content": {"parts": [{"text": "bad" if bad == "not_json" else "{}"}]},
                }
            ]
        }
        if bad == "extra_candidate":
            p["candidates"] *= 2
        return httpx.Response(200, json=p)

    seen = inject(monkeypatch, handler)
    invoke(role, config())
    assert len(seen) == 1


def test_phase_data_privacy_and_secret_free_logs(monkeypatch, caplog):
    def handler(name, role, ctx, body, req):
        if name == "gemini":
            return httpx.Response(
                429, json={"error": {"message": "Do not log provider body or headers"}}
            )
        assert req.headers.get("x-goog-api-key") is None
        assert req.headers["Authorization"] == "Bearer secondary-test-secret"
        return response(name, valid_output(role, ctx))

    seen = inject(monkeypatch, handler)
    with caplog.at_level(logging.INFO, logger=provider.__name__):
        for role in ("judge", "generation", "grounding"):
            assert invoke(role, config()) is not None
    for _name, role, ctx, _body in seen:
        assert set(ctx) == (
            {"question", "species", "aspects", "evidence"}
            if role == "judge"
            else {"question", "species", "depth", "evidence"}
            if role == "generation"
            else {"species", "sentences", "used_chunk_ids", "evidence"}
        )
        if role == "grounding":
            assert not protected_chunks([dict(e, species=ctx["species"]) for e in ctx["evidence"]])
    for forbidden in [
        "primary-test-secret",
        "secondary-test-secret",
        "Authorization",
        "Do not log provider body",
        QUESTION,
    ]:
        assert forbidden not in caplog.text
    assert "phase=grounding provider=groq" in caplog.text


def test_timeout_reserves_secondary_inside_existing_role_cap(monkeypatch):
    timeouts = []
    original = httpx.AsyncClient

    async def transport(req):
        name, role, ctx, body = decoded(req)
        if name == "gemini":
            await asyncio.sleep(0.15)
        return response(name, valid_output(role, ctx))

    def factory(**kw):
        timeouts.append(kw["timeout"])
        return original(transport=httpx.MockTransport(transport), **kw)

    monkeypatch.setattr(provider.httpx, "AsyncClient", factory)
    s = config()
    s.assistant_judge_timeout_seconds = 0.08
    start = time.monotonic()
    out = invoke("judge", s)
    assert out["decision"] == "supported" and time.monotonic() - start < 0.15
    assert timeouts[0] == 0.04 and 0 < timeouts[1] <= 0.04


def test_both_slow_providers_share_one_role_deadline(monkeypatch):
    seen = []
    original = httpx.AsyncClient

    async def transport(req):
        seen.append(req.url.host)
        await asyncio.sleep(0.2)

    monkeypatch.setattr(
        provider.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(transport), **kw),
    )
    s = config()
    s.assistant_judge_timeout_seconds = 0.08
    start = time.monotonic()
    assert invoke("grounding", s) is None
    assert time.monotonic() - start < 0.15 and len(seen) == 2


def test_missing_secondary_keeps_primary_timeout(monkeypatch):
    recorded = []
    original = httpx.AsyncClient

    def factory(**kw):
        recorded.append(kw["timeout"])
        return original(transport=httpx.MockTransport(lambda req: httpx.Response(429)), **kw)

    monkeypatch.setattr(provider.httpx, "AsyncClient", factory)
    s = config()
    s.groq_fallback_enabled = False
    invoke("judge", s)
    assert recorded == [6]


def test_local_translation_error_never_calls_either_provider(monkeypatch):
    monkeypatch.setattr(
        provider.httpx, "AsyncClient", lambda **kw: pytest.fail("Local error is not failover")
    )
    assert asyncio.run(provider.complete({}, "test-primary", "judge", 6, config())) is None


def test_groq_environment_key_is_masked_and_no_default_model(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "secondary-test-secret")
    monkeypatch.setenv("GROQ_FALLBACK_ENABLED", "true")
    monkeypatch.delenv("GROQ_MODEL", raising=False)
    s = Settings(_env_file=None)
    assert s.groq_api_key and "secondary-test-secret" not in repr(s)
    assert s.groq_model is None and not provider.groq_ready(s)


@pytest.mark.parametrize("decision", ["unsupported", "uncertain"])
@pytest.mark.parametrize("role", ["judge", "grounding"])
def test_primary_semantic_denial_stops_router_without_secondary(monkeypatch, decision, role):
    def handler(name, current, ctx, body, req):
        p = valid_output(current, ctx)
        if current == role:
            p["decision"] = decision
        return response(name, p)

    seen = inject(monkeypatch, handler)
    with client(config(), monkeypatch) as c:
        out = post(c)
    assert out["status"] == ("insufficient_evidence" if role == "judge" else "fallback")
    assert all(x[0] == "gemini" for x in seen)
    if role == "judge":
        assert len(seen) == 1


@pytest.mark.parametrize("field", ["assistant_generation_model", "assistant_judge_model"])
@pytest.mark.parametrize("model", [None, "invalid model"])
def test_missing_invalid_primary_model_does_not_use_secondary(monkeypatch, field, model):
    s = config()
    setattr(s, field, model)
    monkeypatch.setattr(
        provider.httpx, "AsyncClient", lambda **kw: pytest.fail("Bad primary config must not route")
    )
    assert invoke("judge" if field == "assistant_judge_model" else "generation", s) is None


@pytest.mark.parametrize(
    "bad", ["multiple", "truncated", "refusal", "tools", "no_content", "oversize"]
)
def test_groq_bad_envelope_is_terminal(monkeypatch, bad):
    def handler(name, role, ctx, body, req):
        if name == "gemini":
            return httpx.Response(429)
        if bad == "oversize":
            return httpx.Response(200, content=b"x" * 65537)
        message = {"content": json.dumps(valid_output(role, ctx))}
        if bad == "refusal":
            message["refusal"] = "not available"
        if bad == "tools":
            message["tool_calls"] = [{"name": "not allowed"}]
        if bad == "no_content":
            message["content"] = None
        candidate = {
            "finish_reason": "length" if bad == "truncated" else "stop",
            "message": message,
        }
        return httpx.Response(200, json={"choices": [candidate] * (2 if bad == "multiple" else 1)})

    seen = inject(monkeypatch, handler)
    assert invoke("grounding", config()) is None and len(seen) == 2


def test_mixed_groq_answer_excludes_protected_text_and_retains_exact_safety(monkeypatch):
    def handler(name, role, ctx, body, req):
        if name == "gemini":
            return httpx.Response(429)
        p = valid_output(role, ctx)
        if role == "generation":
            p["sentences"] = ["It is a fast-growing twining vine."]
        if role in {"generation", "grounding"}:
            assert all(
                e["topic"] not in {"safe_response", "documented_hazards"} for e in ctx["evidence"]
            )
        return response(name, p)

    seen = inject(monkeypatch, handler)
    with client(config(), monkeypatch) as c:
        out = post(
            c, "What does it look like and how should I respond safely?", "mikania-micrantha"
        )
    assert out["status"] == "answer"
    assert out["answer"].endswith(chunks("mikania-micrantha", "safe_response")[0]["content"])
    assert any(x[0] == "groq" and x[1] == "grounding" for x in seen)


def test_outer_shared_deadline_still_caps_failover_sequence(monkeypatch):
    original = httpx.AsyncClient
    seen = []

    async def transport(req):
        name, role, ctx, body = decoded(req)
        seen.append((name, role))
        if name == "gemini":
            return httpx.Response(429)
        await asyncio.sleep(0.03 if role == "judge" else 0.2)
        return response(name, valid_output(role, ctx))

    monkeypatch.setattr(
        provider.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(transport), **kw),
    )
    s = config()
    s.assistant_request_timeout_seconds = 0.08
    start = time.monotonic()
    with client(s, monkeypatch) as c:
        out = post(c)
    assert out["status"] == "fallback" and time.monotonic() - start < 0.18
    assert not any(role == "grounding" for _, role in seen)


@pytest.mark.parametrize(
    "model_field,secret_field",
    [
        ("groq_model", "assistant_generation_key"),
        ("assistant_judge_model", "groq_api_key"),
    ],
)
def test_misplaced_key_in_model_config_never_logged(monkeypatch, caplog, model_field, secret_field):
    s = config()
    setattr(s, model_field, getattr(s, secret_field).get_secret_value())
    seen = inject(monkeypatch, lambda *args: httpx.Response(429))
    with caplog.at_level(logging.INFO, logger=provider.__name__):
        assert invoke("judge", s) is None
    assert all(x[0] == "gemini" for x in seen)
    assert "secondary-test-secret" not in caplog.text and "primary-test-secret" not in caplog.text
