"""Final gate contract, transport and actual router regressions (no live provider)."""

import asyncio
import copy
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers import plant_assistant as router
from app.config import Settings, get_settings
from app.core.rate_limit import rate_limiter
from app.domain.plant_assistant import get_retriever, validate_generated
from app.services import assistant_grounding as gate

SPECIES = "Mikania micrantha"


def evidence(topic="identification"):
    return [
        next(c for c in get_retriever().chunks if c["chunk_id"] == f"CAT-mikania-micrantha-{topic}")
    ]


def supported(species, sentences, chunks, ids):
    return {
        "decision": "supported",
        "species": species,
        "claims": [
            {
                "sentence_index": n,
                "supported": True,
                "supporting_chunk_ids": ids,
                "evidence_quotes": [
                    {"chunk_id": c["chunk_id"], "quote": c["content"]} for c in chunks
                ],
            }
            for n in range(len(sentences))
        ],
    }


@pytest.fixture
def client(monkeypatch):
    s = Settings(
        _env_file=None,
        assistant_generation_enabled=False,
        assistant_judge_enabled=False,
        assistant_generation_key=None,
        rate_limit_enabled=False,
    )
    a = FastAPI()
    a.include_router(router.router)
    a.dependency_overrides[get_settings] = lambda: s
    monkeypatch.setattr(rate_limiter, "enabled", False)
    with TestClient(a) as c:
        yield c, s


def post(c, question="Explain the scan result", depth="standard"):
    return c.post(
        "/api/v1/plant-assistant/ask",
        json={
            "speciesId": "mikania-micrantha",
            "classifierConfidence": 0.95,
            "question": question,
            "depth": depth,
        },
    ).json()


ADVERSARIAL = [
    "Its leaves are purple.",
    "Its stems are heart-shaped.",
    "Its flower heads open in October.",
    "Its flowers appear every week.",
    "Its main identifying feature is white flower heads.",
    "Its ribbed stems cause its leaves to be heart-shaped.",
    "It grows in every Malaysian garden.",
    "Its leaves are opposite and heart-shaped with blue veins.",
]


@pytest.mark.parametrize("sentence", ADVERSARIAL)
def test_unsupported_prose_never_reaches_user(client, monkeypatch, sentence):
    c, _ = client
    chunks = evidence()
    ids = [chunks[0]["chunk_id"]]
    payload = {
        "status": "answer",
        "species": SPECIES,
        "sentences": [sentence],
        "answer": sentence,
        "used_chunk_ids": ids,
    }
    # Even when structurally acceptable, a semantic denial rejects the entire answer.
    assert validate_generated(payload, chunks, SPECIES) is not None
    monkeypatch.setattr(router, "generate", AsyncMock(return_value=payload))
    check = AsyncMock(return_value={"decision": "unsupported", "species": SPECIES, "claims": []})
    monkeypatch.setattr(router, "verify_grounding", check)
    result = post(c)
    assert result["status"] == "fallback" and sentence not in result["answer"]
    assert result["answer"] == chunks[0]["content"]
    check.assert_awaited_once()


POSITIVES = [
    ("identification", "It is a fast-growing twining vine."),
    ("identification", "Its leaves are opposite and heart-shaped."),
    ("identification", "Its stems are slender and ribbed."),
    ("identification", "Its small white flower heads grow in clusters."),
    ("habitat", "It grows at forest edges and riverbanks."),
    ("spread", "Its seeds can spread by wind and water."),
    ("impact", "It rapidly covers shrubs and young trees, suppressing their growth."),
]


@pytest.mark.parametrize("topic,sentence", POSITIVES)
@pytest.mark.parametrize("depth", ["simpler", "standard", "detailed"])
def test_faithful_paraphrases_display_only_after_gate(client, monkeypatch, topic, sentence, depth):
    c, _ = client
    questions = {
        "identification": "Explain the scan result",
        "habitat": "Where does it grow?",
        "spread": "How does it spread?",
        "impact": "What impact does it have?",
    }

    async def generated(q, species, chunks, d, settings):
        return {
            "status": "answer",
            "species": species,
            "sentences": [sentence],
            "answer": sentence,
            "used_chunk_ids": [x["chunk_id"] for x in chunks],
        }

    async def verified(species, sentences, chunks, ids, settings):
        return supported(species, sentences, chunks, ids)

    if topic == "impact":
        from test_assistant_hybrid import judgement

        r = get_retriever()
        q = questions[topic]
        approved = r.classify("mikania-micrantha", q, r.search("mikania-micrantha", q)).evidence
        monkeypatch.setattr(
            router, "evaluate", AsyncMock(return_value=judgement(q, SPECIES, approved))
        )
    monkeypatch.setattr(router, "generate", generated)
    check = AsyncMock(side_effect=verified)
    monkeypatch.setattr(router, "verify_grounding", check)
    result = post(c, questions[topic], depth)
    assert result["status"] == "answer" and result["answer"] == sentence
    check.assert_awaited_once()
    assert {s["chunkId"] for s in result["sources"]} == set(check.await_args.args[3])


@pytest.mark.parametrize(
    "bad",
    [
        "uncertain",
        "unsupported",
        "missing",
        "duplicate",
        "extra",
        "bool_index",
        "false",
        "unknown_id",
        "foreign",
        "quote",
        "quote_pair",
        "unused_id",
        "schema",
        "none",
    ],
)
def test_strict_claim_contract(bad):
    chunks = evidence()
    ids = [chunks[0]["chunk_id"]]
    sentences = ["It is a vine.", "Its leaves are heart-shaped."]
    p = supported(SPECIES, sentences, chunks, ids)
    assert gate.validate_grounding(p, SPECIES, sentences, chunks, ids)
    if bad in ("uncertain", "unsupported"):
        p["decision"] = bad
    elif bad == "missing":
        p["claims"].pop()
    elif bad == "duplicate":
        p["claims"][1]["sentence_index"] = 0
    elif bad == "extra":
        p["claims"].append(copy.deepcopy(p["claims"][0]))
    elif bad == "bool_index":
        p["claims"][0]["sentence_index"] = False
    elif bad == "false":
        p["claims"][0]["supported"] = False
    elif bad == "unknown_id":
        p["claims"][0]["supporting_chunk_ids"] = ["unknown"]
    elif bad == "foreign":
        p["species"] = "Acacia auriculiformis"
    elif bad == "quote":
        p["claims"][0]["evidence_quotes"][0]["quote"] = "purple leaves"
    elif bad == "quote_pair":
        p["claims"][0]["evidence_quotes"][0]["chunk_id"] = "wrong"
    elif bad == "unused_id":
        ids = ids + ["not_used"]
    elif bad == "schema":
        p["answer"] = "untrusted"
    elif bad == "none":
        p = None
    assert not gate.validate_grounding(p, SPECIES, sentences, chunks, ids)


@pytest.mark.parametrize(
    "failure", ["timeout", "network", "429", "503", "malformed", "truncated", "oversize", "multi"]
)
def test_real_adapter_failure_falls_back(client, monkeypatch, failure):
    c, s = client
    s.assistant_generation_enabled = s.assistant_generation_free_tier = True
    from pydantic import SecretStr

    s.assistant_generation_key = SecretStr("test-placeholder")
    s.assistant_generation_model = "test-model"
    sentence = "It is a fast-growing twining vine."
    chunks = evidence()
    ids = [chunks[0]["chunk_id"]]
    monkeypatch.setattr(
        router,
        "generate",
        AsyncMock(
            return_value={
                "status": "answer",
                "species": SPECIES,
                "sentences": [sentence],
                "answer": sentence,
                "used_chunk_ids": ids,
            }
        ),
    )
    seen = []

    def transport(request):
        seen.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("controlled")
        if failure == "network":
            raise httpx.ConnectError("controlled")
        if failure in ("429", "503"):
            return httpx.Response(int(failure))
        if failure == "oversize":
            return httpx.Response(200, content=b"x" * 65537)
        out = supported(SPECIES, [sentence], chunks, ids)
        candidate = {
            "finishReason": "MAX_TOKENS" if failure == "truncated" else "STOP",
            "content": {"parts": [{"text": "bad" if failure == "malformed" else json.dumps(out)}]},
        }
        return httpx.Response(
            200, json={"candidates": [candidate] * (2 if failure == "multi" else 1)}
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        gate.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(transport), **kw),
    )
    result = post(c)
    assert result["status"] == "fallback" and result["answer"] == chunks[0]["content"]
    assert len(seen) == 1
    context = json.loads(json.loads(seen[0].content)["contents"][0]["parts"][0]["text"])
    assert set(context) == {"species", "sentences", "evidence", "used_chunk_ids"}
    assert context["sentences"] == [sentence]
    assert all(set(e) == {"chunk_id", "topic", "content"} for e in context["evidence"])


def test_no_configuration_never_trusts_structure(client, monkeypatch):
    c, _ = client
    chunks = evidence()
    sentence = "It is a vine."
    monkeypatch.setattr(
        router,
        "generate",
        AsyncMock(
            return_value={
                "status": "answer",
                "species": SPECIES,
                "sentences": [sentence],
                "answer": sentence,
                "used_chunk_ids": [chunks[0]["chunk_id"]],
            }
        ),
    )
    monkeypatch.setattr(
        gate.httpx, "AsyncClient", lambda **kw: pytest.fail("Missing config must not connect")
    )
    assert post(c)["status"] == "fallback"


def test_remaining_deadline_bounds_third_call(client, monkeypatch):
    import time

    c, s = client
    s.assistant_request_timeout_seconds = 0.08
    s.assistant_judge_timeout_seconds = 6
    chunks = evidence()
    sentence = "It is a vine."

    async def generated(*args):
        await asyncio.sleep(0.04)
        return {
            "status": "answer",
            "species": SPECIES,
            "sentences": [sentence],
            "answer": sentence,
            "used_chunk_ids": [chunks[0]["chunk_id"]],
        }

    async def verified(*args):
        assert 0 < args[-1].assistant_judge_timeout_seconds < 0.06
        await asyncio.sleep(0.2)

    monkeypatch.setattr(router, "generate", generated)
    monkeypatch.setattr(router, "verify_grounding", verified)
    start = time.monotonic()
    result = post(c)
    assert result["status"] == "fallback" and time.monotonic() - start < 0.18


def test_original_sentence_array_cannot_be_replaced_by_joined_answer():
    chunks = evidence()
    ids = [chunks[0]["chunk_id"]]
    p = {
        "status": "answer",
        "species": SPECIES,
        "sentences": ["It is a vine."],
        "answer": "Its leaves are purple.",
        "used_chunk_ids": ids,
    }
    assert validate_generated(p, chunks, SPECIES) is None


def test_protected_foreign_and_duplicate_evidence_rejected():
    chunks = evidence()
    ids = [chunks[0]["chunk_id"]]
    assert not gate.valid_input(SPECIES, ["It is a vine."], evidence("safe_response"), ids)
    assert not gate.valid_input("Other species", ["It is a vine."], chunks, ids)
    assert not gate.valid_input(SPECIES, ["It is a vine."], chunks + chunks, ids)


@pytest.mark.parametrize(
    "question",
    [
        "Is it safe to touch?",
        "Can I leave stem pieces on damp ground?",
        "When does it flower?",
        "Can I remove it?",
        "Does it grow near me?",
    ],
)
def test_hazard_protected_and_hard_blocks_never_call_grounder(client, monkeypatch, question):
    c, _ = client
    check = AsyncMock(
        side_effect=AssertionError("No botanical verification on protected/refused path")
    )
    monkeypatch.setattr(router, "verify_grounding", check)
    result = post(c, question)
    assert result["status"] in {"fallback", "insufficient_evidence"}
    check.assert_not_called()
