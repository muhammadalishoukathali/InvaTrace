"""Hybrid support decisions, distinct failures and protected output contracts."""

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers import plant_assistant
from app.config import Settings, get_settings
from app.core.rate_limit import rate_limiter
from app.domain.plant_assistant import (
    SupportState,
    get_retriever,
    protected_chunks,
    question_aspects,
    validate_generated,
)
from app.services.assistant_judge import provider_payload, validate_judgement


@pytest.mark.parametrize(
    "question,species,state",
    [
        ("Where does it grow?", "mikania-micrantha", SupportState.DEMONSTRABLY_SUPPORTED),
        (
            "What are its main visual clues?",
            "mikania-micrantha",
            SupportState.DEMONSTRABLY_SUPPORTED,
        ),
        (
            "Can I leave stem pieces on damp ground?",
            "mikania-micrantha",
            SupportState.DEMONSTRABLY_SUPPORTED,
        ),
        (
            "Are its flower spikes curved?",
            "acacia-auriculiformis",
            SupportState.NEEDS_SEMANTIC_REVIEW,
        ),
        (
            "Do its flowers look like a shrimp spike?",
            "ruellia-blechum",
            SupportState.NEEDS_SEMANTIC_REVIEW,
        ),
        ("Are its pods curved?", "acacia-auriculiformis", SupportState.NEEDS_SEMANTIC_REVIEW),
        ("When does it flower?", "mikania-micrantha", SupportState.HARD_BLOCK),
        ("Does it grow near me?", "mikania-micrantha", SupportState.HARD_BLOCK),
        ("Does it mainly spread by water?", "mikania-micrantha", SupportState.HARD_BLOCK),
        ("How fast does it spread?", "mikania-micrantha", SupportState.HARD_BLOCK),
        ("What disease can it cure?", "mikania-micrantha", SupportState.HARD_BLOCK),
        ("Can I cut it if I have permission?", "acacia-auriculiformis", SupportState.HARD_BLOCK),
        ("Can I collect it from a protected area?", "mikania-micrantha", SupportState.HARD_BLOCK),
        ("What is my password?", "mikania-micrantha", SupportState.HARD_BLOCK),
        ("ZXQVVJ", "mikania-micrantha", SupportState.HARD_BLOCK),
    ],
)
def test_tri_state(question, species, state):
    r = get_retriever()
    result = r.classify(species, question, r.search(species, question))
    assert result.state == state
    assert all(c["species_id"] == species for c in result.evidence)


def test_foreign_and_placeholder_cannot_prove_support():
    r = get_retriever()
    source = dict(r.chunks[0], evidence_status="placeholder")
    assert (
        r.classify(source["species_id"], "Where does it grow?", [source]).state
        == SupportState.HARD_BLOCK
    )
    assert (
        r.classify(
            "mikania-micrantha",
            "What is Acacia mangium like?",
            r.search("mikania-micrantha", "What is Acacia mangium like?"),
        ).state
        == SupportState.HARD_BLOCK
    )


@pytest.mark.parametrize(
    "question",
    [
        "What habitats does this plant inhabit?",
        "In what locations is it found?",
        "Which environments does it inhabit?",
    ],
)
def test_generic_paraphrase_recall(question):
    r = get_retriever()
    c = r.search("mikania-micrantha", question)
    assert any(x["topic"] == "habitat" for x in c)
    assert r.classify("mikania-micrantha", question, c).state == SupportState.DEMONSTRABLY_SUPPORTED


@pytest.mark.parametrize(
    "question",
    [
        "Does it inhabit Mars?",
        "Does it inhabit my local area?",
        "Where does it mainly grow?",
        "Does it inhabit salt water?",
    ],
)
def test_normalisation_does_not_prove_unknown_scope(question):
    r = get_retriever()
    d = r.classify("mikania-micrantha", question, r.search("mikania-micrantha", question))
    assert d.state != SupportState.DEMONSTRABLY_SUPPORTED


def test_direct_relations_are_content_bound():
    r = get_retriever()
    c = r.search("mikania-micrantha", "Does it spread by wind?")
    assert (
        r.classify("mikania-micrantha", "Does it spread by wind?", c).state
        == SupportState.DEMONSTRABLY_SUPPORTED
    )
    changed = [dict(x, content="No pathway has been established.") for x in c]
    assert (
        r.classify("mikania-micrantha", "Does it spread by wind?", changed).state
        != SupportState.DEMONSTRABLY_SUPPORTED
    )


@pytest.mark.parametrize(
    "question",
    [
        "Does it usually spread by water?",
        "Does it typically spread by water?",
        "Where does it usually grow?",
        "Where should I grow it?",
        "What is its main habitat?",
        "Does it spread by wind if I cut it?",
        "Would we grow it?",
        "If it grows, what does it look like?",
    ],
)
def test_modifiers_are_not_discarded_as_proof(question):
    r = get_retriever()
    assert (
        r.classify("mikania-micrantha", question, r.search("mikania-micrantha", question)).state
        != SupportState.DEMONSTRABLY_SUPPORTED
    )


def judgement(question, species, evidence):
    c = evidence[0]
    return {
        "decision": "supported",
        "species": species,
        "supporting_chunk_ids": [c["chunk_id"]],
        "aspect_support": [
            {
                "aspect": a,
                "supporting_chunk_ids": [c["chunk_id"]],
                "evidence_quotes": [c["content"]],
            }
            for a in question_aspects(question)
        ],
    }


@pytest.mark.parametrize(
    "bad",
    [
        "uncertain",
        "unsupported",
        "unknown",
        "species",
        "missing_aspect",
        "made_up_aspect",
        "unknown_aspect_id",
        "quote",
        "duplicate",
        "extra",
        "wrong_type",
        "empty",
    ],
)
def test_judge_contract_fails_closed(bad):
    r = get_retriever()
    q = "Are its flowers curved and are its pods twisted?"
    s = "Acacia auriculiformis"
    e = r.search("acacia-auriculiformis", q)
    p = judgement(q, s, e)
    if bad in ["uncertain", "unsupported"]:
        p["decision"] = bad
    if bad == "unknown":
        p["supporting_chunk_ids"] = ["invented"]
    if bad == "species":
        p["species"] = "Mikania micrantha"
    if bad == "missing_aspect":
        p["aspect_support"].pop()
    if bad == "made_up_aspect":
        p["aspect_support"][0]["aspect"] = "different aspect"
    if bad == "unknown_aspect_id":
        p["aspect_support"][0]["supporting_chunk_ids"] = ["invented"]
    if bad == "quote":
        p["aspect_support"][0]["evidence_quotes"] = ["Invented quote"]
    if bad == "duplicate":
        p["supporting_chunk_ids"] *= 2
    if bad == "extra":
        p["source_url"] = "https://invented.example"
    if bad == "wrong_type":
        p["aspect_support"] = {}
    if bad == "empty":
        p["supporting_chunk_ids"] = []
    assert validate_judgement(p, q, s, e) is None


def test_judge_contract_reference_and_privacy_whitelist():
    import json

    r = get_retriever()
    q = "Are its pods twisted?"
    s = "Acacia auriculiformis"
    e = r.search("acacia-auriculiformis", q)
    p = judgement(q, s, e)
    assert validate_judgement(p, q, s, e) == [e[0]]
    ctx = json.loads(provider_payload(q, s, e)["contents"][0]["parts"][0]["text"])
    assert set(ctx) == {"question", "species", "aspects", "evidence"}
    assert all(set(c) == {"chunk_id", "topic", "content", "jurisdiction"} for c in ctx["evidence"])
    assert "sources" not in ctx and "species_id" not in ctx
    # This checks schema and reference integrity, never truth of the judgement.


@pytest.mark.parametrize(
    "failure", ["timeout", "network", "429", "503", "json", "truncated", "blocked", "oversize"]
)
def test_judge_transport_errors_are_single_attempt(monkeypatch, failure):
    import asyncio

    import httpx

    from app.config import Settings
    from app.services import assistant_judge

    seen = []

    def transport(request):
        seen.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("test timeout")
        if failure == "network":
            raise httpx.ConnectError("test unavailable")
        if failure in ["429", "503"]:
            return httpx.Response(int(failure))
        if failure == "oversize":
            return httpx.Response(200, content=b"x" * 65537)
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "finishReason": "MAX_TOKENS"
                        if failure == "truncated"
                        else "SAFETY"
                        if failure == "blocked"
                        else "STOP",
                        "content": {"parts": [{"text": "invalid JSON"}]},
                    }
                ]
            },
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        assistant_judge.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(transport), **kw),
    )
    s = Settings(
        _env_file=None,
        assistant_judge_enabled=True,
        assistant_generation_free_tier=True,
        assistant_generation_key="test-placeholder",
        assistant_judge_model="test-model",
    )
    r = get_retriever()
    q = "Are its pods twisted?"
    e = r.search("acacia-auriculiformis", q)
    assert asyncio.run(assistant_judge.evaluate(q, "Acacia auriculiformis", e, s)) is None
    assert len(seen) == 1


def test_judge_disabled_and_missing_configuration_never_opens_transport(monkeypatch):
    import asyncio

    from app.config import Settings
    from app.services import assistant_judge

    monkeypatch.setattr(
        assistant_judge.httpx, "AsyncClient", lambda **kw: pytest.fail("Provider forbidden")
    )
    for enabled in [False, True]:
        s = Settings(_env_file=None, assistant_judge_enabled=enabled, assistant_generation_key=None)
        assert asyncio.run(assistant_judge.evaluate("q", "species", [], s)) is None


@pytest.fixture
def hybrid_client(monkeypatch):
    s = Settings(
        _env_file=None,
        assistant_generation_enabled=False,
        assistant_judge_enabled=False,
        assistant_generation_key=None,
        rate_limit_enabled=False,
    )
    a = FastAPI()
    a.include_router(plant_assistant.router)
    a.dependency_overrides[get_settings] = lambda: s
    monkeypatch.setattr(rate_limiter, "enabled", False)
    with TestClient(a) as c:
        yield c, s


def post(client, question, species="acacia-auriculiformis", **kw):
    return client.post(
        "/api/v1/plant-assistant/ask",
        json={"question": question, "speciesId": species, "classifierConfidence": 0.95, **kw},
    ).json()


@pytest.mark.parametrize(
    "decision",
    ["unsupported", "uncertain", "malformed", "unknown_id", "missing_aspect", "missing_config"],
)
def test_runtime_judge_failure_never_generates(hybrid_client, monkeypatch, decision):
    c, s = hybrid_client
    q = "Are its flower spikes curved?"
    r = get_retriever()
    e = r.classify("acacia-auriculiformis", q, r.search("acacia-auriculiformis", q)).evidence
    p = judgement(q, "Acacia auriculiformis", e)
    if decision in ["unsupported", "uncertain"]:
        p["decision"] = decision
    if decision == "malformed":
        p = []
    if decision == "unknown_id":
        p["supporting_chunk_ids"] = ["unknown"]
    if decision == "missing_aspect":
        p["aspect_support"] = []
    if decision != "missing_config":
        monkeypatch.setattr(plant_assistant, "evaluate", AsyncMock(return_value=p))
    g = AsyncMock(side_effect=AssertionError("Judge failure must not generate"))
    monkeypatch.setattr(plant_assistant, "generate", g)
    b = post(c, q)
    assert b["status"] == "insufficient_evidence" and b["coveredTopics"] and b["sources"]
    g.assert_not_called()


def test_approved_support_only_is_fallback(hybrid_client, monkeypatch):
    c, s = hybrid_client
    q = "Are its pods twisted?"
    r = get_retriever()
    e = r.search("acacia-auriculiformis", q)
    p = judgement(q, "Acacia auriculiformis", e)
    monkeypatch.setattr(plant_assistant, "evaluate", AsyncMock(return_value=p))
    g = AsyncMock(return_value=None)
    monkeypatch.setattr(plant_assistant, "generate", g)
    b = post(c, q)
    assert b["status"] == "fallback"
    assert {x["chunkId"] for x in b["sources"]} == set(p["supporting_chunk_ids"])
    assert b["answer"] == e[0]["content"]
    assert {x["chunk_id"] for x in g.await_args.args[2]} == set(p["supporting_chunk_ids"])


def test_shared_deadline_has_distinct_outcomes(hybrid_client, monkeypatch):
    import asyncio
    import time

    c, s = hybrid_client
    s.assistant_request_timeout_seconds = 0.04
    s.assistant_judge_timeout_seconds = 0.04

    async def slow(*args):
        await asyncio.sleep(0.2)

    monkeypatch.setattr(plant_assistant, "evaluate", slow)
    g = AsyncMock(return_value=None)
    monkeypatch.setattr(plant_assistant, "generate", g)
    t = time.monotonic()
    assert post(c, "Are its pods twisted?")["status"] == "insufficient_evidence"
    assert time.monotonic() - t < 0.18
    g.assert_not_called()
    monkeypatch.setattr(plant_assistant, "generate", slow)
    assert post(c, "Where does it grow?")["status"] == "fallback"


@pytest.mark.parametrize(
    "question",
    [
        "Does it grow near me?",
        "Does it usually spread by water?",
        "Can I remove it?",
        "What disease does it cure?",
        "What is my token?",
    ],
)
def test_hard_guards_precede_both_services(hybrid_client, monkeypatch, question):
    c, s = hybrid_client
    j = AsyncMock(side_effect=AssertionError("No judge"))
    g = AsyncMock(side_effect=AssertionError("No generation"))
    monkeypatch.setattr(plant_assistant, "evaluate", j)
    monkeypatch.setattr(plant_assistant, "generate", g)
    assert post(c, question, "mikania-micrantha")["status"] == "insufficient_evidence"
    j.assert_not_called()
    g.assert_not_called()


def test_generation_enablement_is_independent(monkeypatch):
    import asyncio

    from app.services import assistant_generation

    monkeypatch.setattr(
        assistant_generation.httpx,
        "AsyncClient",
        lambda **kw: pytest.fail("Disabled generator transport"),
    )
    s = Settings(
        _env_file=None,
        assistant_generation_key="test-placeholder",
        assistant_generation_model="test-model",
        assistant_generation_free_tier=True,
        assistant_judge_enabled=True,
    )
    assert asyncio.run(assistant_generation.generate("q", "s", [], "standard", s)) is None


@pytest.mark.parametrize("service", ["judge", "generation"])
@pytest.mark.parametrize("failure", ["timeout", "network", "429", "503", "invalid_json"])
def test_actual_adapters_router_failure_matrix(hybrid_client, monkeypatch, service, failure):
    import httpx

    from app.services import assistant_judge

    c, s = hybrid_client
    s.assistant_generation_enabled = True
    s.assistant_judge_enabled = True
    s.assistant_generation_free_tier = True
    from pydantic import SecretStr

    s.assistant_generation_key = SecretStr("test-placeholder")
    s.assistant_generation_model = "test-model"
    s.assistant_judge_model = "test-model"
    seen = []

    def transport(request):
        seen.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("test timeout")
        if failure == "network":
            raise httpx.ConnectError("test unavailable")
        if failure in ["429", "503"]:
            return httpx.Response(int(failure))
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"finishReason": "STOP", "content": {"parts": [{"text": "invalid JSON"}]}}
                ]
            },
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        assistant_judge.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(transport), **kw),
    )
    if service == "judge":
        g = AsyncMock(side_effect=AssertionError("Judge outage must not generate"))
        monkeypatch.setattr(plant_assistant, "generate", g)
        b = post(c, "Are its pods twisted?")
        assert b["status"] == "insufficient_evidence"
        g.assert_not_called()
    else:
        j = AsyncMock(side_effect=AssertionError("Direct support needs no judge"))
        monkeypatch.setattr(plant_assistant, "evaluate", j)
        b = post(c, "Where does it grow?")
        assert b["status"] == "fallback"
        j.assert_not_called()
    assert len(seen) == 1
    assert all("key=" not in str(x.url) for x in seen)


@pytest.mark.parametrize(
    "question",
    [
        "Does it grow in their local area?",
        "Does it grow in his garden?",
        "Does it grow in her neighbourhood?",
        "Does it grow in our suburb?",
        "Does it harm a dog?",
        "Does it harm livestock?",
        "Will it hurt my cat?",
        "Will a dog become sick?",
    ],
)
def test_additional_local_and_animal_health_hard_guards(hybrid_client, monkeypatch, question):
    c, s = hybrid_client
    r = get_retriever()
    assert (
        r.classify("mikania-micrantha", question, r.search("mikania-micrantha", question)).state
        == SupportState.HARD_BLOCK
    )
    j = AsyncMock(side_effect=AssertionError("No judge"))
    g = AsyncMock(side_effect=AssertionError("No generator"))
    monkeypatch.setattr(plant_assistant, "evaluate", j)
    monkeypatch.setattr(plant_assistant, "generate", g)
    assert post(c, question, "mikania-micrantha")["status"] == "insufficient_evidence"
    j.assert_not_called()
    g.assert_not_called()


@pytest.mark.parametrize("question", ["Does it spread on animals?", "Can animals spread it?"])
def test_animal_spread_is_not_medical_exclusion(question):
    r = get_retriever()
    assert (
        r.classify("mikania-micrantha", question, r.search("mikania-micrantha", question)).state
        == SupportState.NEEDS_SEMANTIC_REVIEW
    )


def test_bare_credential_format_is_rejected_before_both_services(hybrid_client, monkeypatch):
    c, s = hybrid_client
    j = AsyncMock(side_effect=AssertionError("No judge"))
    g = AsyncMock(side_effect=AssertionError("No generator"))
    monkeypatch.setattr(plant_assistant, "evaluate", j)
    monkeypatch.setattr(plant_assistant, "generate", g)
    q = "AQ." + "a" * 25
    assert post(c, q)["status"] == "insufficient_evidence"
    j.assert_not_called()
    g.assert_not_called()


@pytest.mark.parametrize(
    "question",
    [
        "Where does it grow? My name is Test Person.",
        "Where does it grow? My address is 10 Test Road.",
        "Where does it grow? My student ID is test123.",
        "Where does it grow? The profile ID is test123.",
    ],
)
def test_identity_declarations_do_not_reach_provider(hybrid_client, monkeypatch, question):
    c, s = hybrid_client
    j = AsyncMock(side_effect=AssertionError("No judge"))
    g = AsyncMock(side_effect=AssertionError("No generator"))
    monkeypatch.setattr(plant_assistant, "evaluate", j)
    monkeypatch.setattr(plant_assistant, "generate", g)
    assert post(c, question)["status"] == "insufficient_evidence"
    j.assert_not_called()
    g.assert_not_called()


@pytest.mark.parametrize(
    "species,old,new",
    [
        ("eichhornia-crassipes", "Never enter water", "Avoid entering water"),
        ("mikania-micrantha", "Do not pull vines", "Try not to pull vines"),
        (
            "asclepias-curassavica",
            "obtain permission before any handling",
            "permission may be useful before handling",
        ),
        (
            "acacia-auriculiformis",
            "Do not cut or remove it without site permission.",
            "If you have site permission, you may cut or remove it.",
        ),
        ("asclepias-curassavica", "can irritate skin", "is usually harmless to skin"),
    ],
)
def test_complete_safety_and_hazard_words_cannot_weaken(species, old, new):
    r = get_retriever()
    chunk = next(c for c in r.chunks if c["species_id"] == species and old in c["content"])
    assert protected_chunks([chunk]) == [chunk]
    p = {"status": "answer", "answer": chunk["content"], "used_chunk_ids": [chunk["chunk_id"]]}
    assert validate_generated(p, [chunk]) is not None
    p["answer"] = p["answer"].replace(old, new)
    assert validate_generated(p, [chunk]) is None


@pytest.mark.parametrize("depth", ["simpler", "standard", "detailed"])
@pytest.mark.parametrize(
    "species,question",
    [
        ("mikania-micrantha", "Can I leave stem pieces on damp ground?"),
        ("asclepias-curassavica", "Is it safe to touch?"),
        ("eichhornia-crassipes", "Can I enter water to remove it?"),
    ],
)
def test_protected_routes_are_backend_only(hybrid_client, monkeypatch, depth, species, question):
    c, s = hybrid_client
    g = AsyncMock(side_effect=AssertionError("Protected-only content must not generate"))
    monkeypatch.setattr(plant_assistant, "generate", g)
    b = post(c, question, species, depth=depth)
    assert b["status"] == "fallback" and b["answerability"] == "answerable"
    g.assert_not_called()
    ids = {x["chunkId"] for x in b["sources"]}
    e = [x for x in get_retriever().chunks if x["chunk_id"] in ids]
    assert len(protected_chunks(e)) == len(e)
    assert b["answer"] == "\n\n".join(x["content"] for x in e)


@pytest.mark.parametrize("species", ["mikania-micrantha", "asclepias-curassavica"])
def test_general_safe_response_is_backend_guidance_not_action_advice(
    hybrid_client, monkeypatch, species
):
    c, s = hybrid_client
    g = AsyncMock(side_effect=AssertionError("Complete safety guidance is backend-only"))
    monkeypatch.setattr(plant_assistant, "generate", g)
    b = post(c, "How should I respond safely?", species)
    assert b["status"] == "fallback"
    g.assert_not_called()
    assert b["answer"] == next(
        x["content"]
        for x in get_retriever().chunks
        if x["species_id"] == species and x["topic"] == "safe_response"
    )


def test_depth_policies_and_protected_generation_exclusion():
    import json

    from app.services import assistant_generation as g

    r = get_retriever()
    e = r.search("mikania-micrantha", "What does it look like and how should I respond safely?")
    policies = []
    for depth in ["simpler", "standard", "detailed"]:
        p = g.provider_payload("q", "Mikania micrantha", e, depth)
        ctx = json.loads(p["contents"][0]["parts"][0]["text"])
        assert ctx["depth"] == depth
        assert not (
            {x["chunk_id"] for x in ctx["evidence"]} & {x["chunk_id"] for x in protected_chunks(e)}
        )
        assert "species" in p["generationConfig"]["responseJsonSchema"]["required"]
        policies.append(p["systemInstruction"]["parts"][0]["text"])
    assert len(set(policies)) == 3
    # Prompt differentiation is preparation, not evidence of real generated depth.


@pytest.mark.parametrize(
    "text",
    [
        "A climbing vine with opposite, heart-shaped leaves.",
        "Mikania micrantha is a climbing vine. Its opposite leaves are heart-shaped and its flower heads are small and white.",
        "Mikania micrantha climbs over vegetation. Its leaves grow in opposite pairs and have a heart shape. Its small white flower heads form clusters.",
    ],
)
def test_structural_paraphrase_and_complete_mixed_safety(text):
    r = get_retriever()
    e = [
        next(c for c in r.chunks if c["species_id"] == "mikania-micrantha" and c["topic"] == t)
        for t in ["identification", "safe_response"]
    ]
    p = {
        "status": "answer",
        "species": "Mikania micrantha",
        "answer": text,
        "used_chunk_ids": [e[0]["chunk_id"]],
    }
    result = validate_generated(p, e, "Mikania micrantha")
    assert result == (text + "\n\n" + e[1]["content"], e)
    # These controlled strings test the rendering contract, not live quality.


@pytest.mark.parametrize(
    "bad",
    [
        "species",
        "status",
        "unknown_id",
        "protected_id",
        "empty",
        "duplicate",
        "extra",
        "missing_id",
        "url",
        "permission",
        "weakening",
        "status_override",
        "foreign_species",
        "ranking",
    ],
)
def test_new_generation_contract_rejects_boundary_violations(bad):
    r = get_retriever()
    e = [
        next(c for c in r.chunks if c["species_id"] == "mikania-micrantha" and c["topic"] == t)
        for t in ["identification", "safe_response"]
    ]
    p = {
        "status": "answer",
        "species": "Mikania micrantha",
        "answer": "A vine with heart-shaped leaves.",
        "sentences": ["A vine with heart-shaped leaves."],
        "used_chunk_ids": [e[0]["chunk_id"]],
    }
    if bad == "species":
        p["species"] = "Acacia auriculiformis"
    if bad == "status":
        p["status"] = "fallback"
    if bad == "unknown_id":
        p["used_chunk_ids"] = ["invented"]
    if bad == "protected_id":
        p["used_chunk_ids"].append(e[1]["chunk_id"])
    if bad == "empty":
        p["answer"] = " "
    if bad == "duplicate":
        p["used_chunk_ids"] *= 2
    if bad == "extra":
        p["sources"] = []
    if bad == "missing_id":
        p["used_chunk_ids"] = []
    if bad == "url":
        p["answer"] += " See https://invented.example."
    if bad == "permission":
        p["answer"] += " Permission is optional."
    if bad == "weakening":
        p["answer"] += " Try not to pull vines."
    if bad == "status_override":
        p["answer"] += " The classifier is wrong."
    if bad == "foreign_species":
        p["answer"] = "Acacia auriculiformis has these leaves."
    if bad == "ranking":
        p["answer"] += " It usually grows in gardens."
    assert validate_generated(p, e, "Mikania micrantha") is None


@pytest.mark.parametrize(
    "text",
    [
        "Avoid touching it.",
        "Try not to remove it.",
        "With permission you may cut it.",
        "It is probably harmless.",
        "It is usually harmless to skin.",
        "You may go into the pond and take it.",
        "Enter the water to get it.",
        "Uproot the plant.",
        "Go into the water.",
        "Walk into the pond.",
        "Report it.",
        "Observe it closely.",
        "Inspect the plant closely.",
        "Approach the pond.",
        "Proceed to the water.",
        "Place it in a bag.",
        "Return it to the water.",
        "It has leaves. Inspect it closely.",
        "It is time to inspect the plant.",
    ],
)
def test_new_contract_safety_weakening_cannot_hide_in_botanical_prose(text):
    r = get_retriever()
    e = [
        next(c for c in r.chunks if c["species_id"] == "asclepias-curassavica" and c["topic"] == t)
        for t in ["identification", "safe_response"]
    ]
    assert (
        validate_generated(
            {
                "status": "answer",
                "species": "Asclepias curassavica",
                "answer": text,
                "used_chunk_ids": [e[0]["chunk_id"]],
            },
            e,
            "Asclepias curassavica",
        )
        is None
    )


@pytest.mark.parametrize(
    "failure", ["truncated", "blocked", "multiple", "oversize", "thought_only", "bad_parts"]
)
def test_generation_transport_contract_failures(monkeypatch, failure):
    import asyncio
    import json

    import httpx

    from app.services import assistant_generation as g

    seen = []

    def transport(request):
        seen.append(request)
        if failure == "oversize":
            return httpx.Response(200, content=b"x" * 65537)
        candidate = {
            "finishReason": "MAX_TOKENS"
            if failure == "truncated"
            else "SAFETY"
            if failure == "blocked"
            else "STOP",
            "content": {"parts": [{"text": json.dumps({"status": "answer"})}]},
        }
        if failure == "thought_only":
            candidate["content"]["parts"][0]["thought"] = True
        if failure == "bad_parts":
            candidate["content"]["parts"] = [None]
        return httpx.Response(
            200, json={"candidates": [candidate] * (2 if failure == "multiple" else 1)}
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        g.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(transport), **kw),
    )
    s = Settings(
        _env_file=None,
        assistant_generation_enabled=True,
        assistant_generation_free_tier=True,
        assistant_generation_key="test-placeholder",
        assistant_generation_model="test-model",
    )
    e = [
        next(
            x
            for x in get_retriever().chunks
            if x["chunk_id"] == "CAT-mikania-micrantha-identification"
        )
    ]
    assert asyncio.run(g.generate("q", "Mikania micrantha", e, "standard", s)) is None
    assert len(seen) == 1


def test_final_gate_rejects_structurally_valid_purple_leaves(hybrid_client, monkeypatch):
    c, _ = hybrid_client
    e = [
        next(
            c
            for c in get_retriever().chunks
            if c["chunk_id"] == "CAT-mikania-micrantha-identification"
        )
    ]
    p = {
        "status": "answer",
        "species": "Mikania micrantha",
        "sentences": ["Its leaves are purple."],
        "answer": "Its leaves are purple.",
        "used_chunk_ids": [e[0]["chunk_id"]],
    }
    assert validate_generated(p, e, "Mikania micrantha") is not None
    monkeypatch.setattr(plant_assistant, "generate", AsyncMock(return_value=p))
    monkeypatch.setattr(
        plant_assistant,
        "verify_grounding",
        AsyncMock(
            return_value={"decision": "unsupported", "species": "Mikania micrantha", "claims": []}
        ),
    )
    b = post(c, "Explain the scan result", "mikania-micrantha")
    assert b["status"] == "fallback" and "purple" not in b["answer"]


def test_actual_router_mixed_rendering_and_citations(hybrid_client, monkeypatch):
    c, s = hybrid_client
    q = "What does it look like and how should I respond safely?"
    r = get_retriever()
    e = r.classify("mikania-micrantha", q, r.search("mikania-micrantha", q)).evidence
    p = {
        "decision": "supported",
        "species": "Mikania micrantha",
        "supporting_chunk_ids": [x["chunk_id"] for x in e],
        "aspect_support": [
            {
                "aspect": a,
                "supporting_chunk_ids": [x["chunk_id"]],
                "evidence_quotes": [x["content"]],
            }
            for a, x in zip(question_aspects(q), e, strict=True)
        ],
    }
    monkeypatch.setattr(plant_assistant, "evaluate", AsyncMock(return_value=p))

    async def generated(q, species, e, depth, settings):
        return {
            "status": "answer",
            "species": species,
            "answer": "A vine with heart-shaped leaves.",
            "sentences": ["A vine with heart-shaped leaves."],
            "used_chunk_ids": [x["chunk_id"] for x in e if x not in protected_chunks(e)],
        }

    from test_assistant_grounding import supported

    async def verified(species, sentences, chunks, ids, settings):
        assert not protected_chunks(chunks)
        assert sentences == ["A vine with heart-shaped leaves."]
        return supported(species, sentences, chunks, ids)

    monkeypatch.setattr(plant_assistant, "verify_grounding", verified)
    monkeypatch.setattr(plant_assistant, "generate", generated)
    b = post(c, "What does it look like and how should I respond safely?", "mikania-micrantha")
    assert b["status"] == "answer"
    protected = next(
        x for x in get_retriever().chunks if x["chunk_id"] == "CAT-mikania-micrantha-safe_response"
    )
    assert b["answer"].endswith(protected["content"])
    assert {x["chunkId"] for x in b["sources"]} == {
        "CAT-mikania-micrantha-identification",
        protected["chunk_id"],
    }
    assert b["safetyBoundary"].startswith("This assistant does not grant permission")


def test_backend_environment_configuration_is_masked_and_independently_toggled(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-placeholder")
    monkeypatch.setenv("ASSISTANT_GENERATION_MODEL", "test-model")
    monkeypatch.setenv("ASSISTANT_JUDGE_MODEL", "test-model")
    monkeypatch.setenv("ASSISTANT_JUDGE_ENABLED", "true")
    monkeypatch.setenv("ASSISTANT_GENERATION_ENABLED", "false")
    s = Settings(_env_file=None)
    assert s.assistant_generation_key and "test-placeholder" not in repr(s)
    assert s.assistant_judge_enabled and not s.assistant_generation_enabled
    monkeypatch.setenv("ASSISTANT_GENERATION_ENABLED", "true")
    monkeypatch.setenv("ASSISTANT_JUDGE_ENABLED", "false")
    s = Settings(_env_file=None)
    assert s.assistant_generation_enabled and not s.assistant_judge_enabled


@pytest.mark.parametrize("provider_enabled", [False, True])
def test_environment_only_production_app_start_and_missing_provider_are_safe(
    monkeypatch, provider_enabled
):
    from app import main
    from app.services import assistant_generation

    for name, value in {
        "APP_ENV": "production",
        "JWT_SECRET": "j" * 40,
        "CREDENTIAL_HASH_KEY": "c" * 40,
        "LOCATION_PRIVACY_KEY": "l" * 40,
        "S3_SECRET_ACCESS_KEY": "s" * 40,
        "CORS_ORIGINS": "https://frontend.example.test",
        "ASSISTANT_GENERATION_ENABLED": str(provider_enabled),
        "ASSISTANT_JUDGE_ENABLED": str(provider_enabled),
        "ASSISTANT_GENERATION_FREE_TIER": "true",
        "ASSISTANT_GENERATION_MODEL": "test-model",
        "ASSISTANT_JUDGE_MODEL": "test-model",
        "RUN_WORKERS_IN_API": "false",
        "SELF_KEEPALIVE_ENABLED": "false",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("ASSISTANT_GENERATION_KEY", raising=False)
    s = Settings(_env_file=None)
    assert not s.assistant_generation_key
    monkeypatch.setattr(main, "get_settings", lambda: s)
    monkeypatch.setattr(rate_limiter, "enabled", False)
    monkeypatch.setattr(
        assistant_generation.httpx,
        "AsyncClient",
        lambda **kw: pytest.fail("Missing provider must not connect"),
    )
    a = main.create_app()
    a.dependency_overrides[get_settings] = lambda: s
    with TestClient(a) as c:
        assert c.get("/health/live").json() == {"status": "ok"}
        assert post(c, "Where does it grow?")["status"] == "fallback"
        assert post(c, "Are its flower spikes curved?")["status"] == "insufficient_evidence"
    # App/lifespan/env wiring only; no Docker migration, DB/Redis/storage readiness claim.


def test_actual_three_adapter_http_contract_path(hybrid_client, monkeypatch):
    import json

    import httpx
    from pydantic import SecretStr

    from app.services import assistant_judge

    c, s = hybrid_client
    q = "Are its pods twisted?"
    r = get_retriever()
    e = r.classify("acacia-auriculiformis", q, r.search("acacia-auriculiformis", q)).evidence
    p = judgement(q, "Acacia auriculiformis", e)
    s.assistant_judge_enabled = True
    s.assistant_generation_enabled = True
    s.assistant_generation_free_tier = True
    s.assistant_generation_key = SecretStr("test-placeholder")
    s.assistant_judge_model = "test-judge"
    s.assistant_generation_model = "test-generation"
    seen = []

    def transport(request):
        seen.append(request)
        out = (
            p
            if "test-judge:" in str(request.url)
            else {
                "status": "answer",
                "species": "Acacia auriculiformis",
                "sentences": ["Its pods are twisted."],
                "used_chunk_ids": p["supporting_chunk_ids"],
            }
        )
        if (
            "claims"
            in json.loads(request.content)["generationConfig"]["responseJsonSchema"]["properties"]
        ):
            from test_assistant_grounding import supported

            out = supported(
                "Acacia auriculiformis", ["Its pods are twisted."], e, p["supporting_chunk_ids"]
            )
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {
                            "parts": [
                                {"thought": True, "text": "not response content"},
                                {"text": json.dumps(out)},
                            ]
                        },
                    }
                ]
            },
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        assistant_judge.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(transport), **kw),
    )
    b = post(c, q)
    assert b["status"] == "answer" and b["answer"] == "Its pods are twisted."
    assert len(seen) == 3 and {x["chunkId"] for x in b["sources"]} == set(p["supporting_chunk_ids"])
    assert "not response content" not in b["answer"]
    # Original adapters and router, controlled HTTP responses; no live semantic proof.


@pytest.mark.parametrize(
    "question,species",
    [
        ("What are its pods like?", "mikania-micrantha"),
        ("What are its flowers like?", "acacia-auriculiformis"),
    ],
)
def test_component_requests_do_not_inherit_all_identification_attributes(
    hybrid_client, monkeypatch, question, species
):
    c, s = hybrid_client
    r = get_retriever()
    e = r.search(species, question)
    assert r.classify(species, question, e).state == SupportState.NEEDS_SEMANTIC_REVIEW
    g = AsyncMock(side_effect=AssertionError("No generation after missing semantic review"))
    monkeypatch.setattr(plant_assistant, "generate", g)
    assert post(c, question, species)["status"] == "insufficient_evidence"
    g.assert_not_called()


@pytest.mark.parametrize(
    "species", ["asclepias-curassavica", "parthenium-hysterophorus", "mikania-micrantha"]
)
def test_causality_is_not_proven_by_a_whole_impact_topic(hybrid_client, monkeypatch, species):
    c, s = hybrid_client
    r = get_retriever()
    q = "Why is it invasive?"
    assert r.classify(species, q, r.search(species, q)).state == SupportState.NEEDS_SEMANTIC_REVIEW
    g = AsyncMock(side_effect=AssertionError("Causal support needs judge"))
    monkeypatch.setattr(plant_assistant, "generate", g)
    assert post(c, q, species)["status"] == "insufficient_evidence"
    g.assert_not_called()


def test_runtime_source_narrowing_excludes_unverified_old_claims():
    r = get_retriever()
    assert not any(
        "eyes" in x["content"] or "respiratory reactions" in x["content"] for x in r.chunks
    )
    assert not any(x["chunk_id"] == "CAT-asclepias-curassavica-spread-impact" for x in r.chunks)
    assert "spread" not in r.covered_topics("asclepias-curassavica")
    assert len({x["species_id"] for x in r.chunks if x["topic"] == "spread"}) == 17


@pytest.mark.parametrize("species", ["asclepias-curassavica", "acacia-auriculiformis"])
@pytest.mark.parametrize(
    "q",
    [
        "How does it spread?",
        "Why does it spread?",
        "Why does it spread by water?",
        "Does it spread if it grows?",
    ],
)
def test_missing_requested_topic_is_not_sent_for_semantic_guessing(
    hybrid_client, monkeypatch, species, q
):
    c, s = hybrid_client
    r = get_retriever()
    assert r.classify(species, q, r.search(species, q)).state == SupportState.HARD_BLOCK
    j = AsyncMock(side_effect=AssertionError("No relevant topic evidence"))
    g = AsyncMock(side_effect=AssertionError("No generation"))
    monkeypatch.setattr(plant_assistant, "evaluate", j)
    monkeypatch.setattr(plant_assistant, "generate", g)
    assert post(c, q, species)["status"] == "insufficient_evidence"
    j.assert_not_called()
    g.assert_not_called()


@pytest.mark.parametrize(
    "sentences,depth,accepted",
    [
        (["Its pods are twisted."], "simpler", True),
        (["Its pods are twisted. The plant bears curved phyllodes."], "simpler", False),
        (["Its pods are twisted.", "The plant bears curved phyllodes."], "standard", True),
        (["Its pods are twisted.", "The plant bears curved phyllodes."], "simpler", False),
        ([], "standard", False),
        ([""], "standard", False),
        ([None], "standard", False),
        ("Its pods are twisted.", "standard", False),
        (["Its pods are twisted.", "ITS PODS ARE TWISTED."], "standard", False),
        (["Its pods are twisted."] * 6, "detailed", False),
    ],
)
def test_generation_sentence_wire_contract(monkeypatch, sentences, depth, accepted):
    import asyncio
    import json

    import httpx

    from app.services import assistant_generation as g

    e = [
        next(
            x
            for x in get_retriever().chunks
            if x["chunk_id"] == "CAT-acacia-auriculiformis-identification"
        )
    ]
    seen = []

    def transport(request):
        seen.append(json.loads(request.content))
        payload = {
            "status": "answer",
            "species": "Acacia auriculiformis",
            "sentences": sentences,
            "used_chunk_ids": [e[0]["chunk_id"]],
        }
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(payload)}]}}
                ]
            },
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        g.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(transport), **kw),
    )
    s = Settings(
        _env_file=None,
        assistant_generation_enabled=True,
        assistant_generation_free_tier=True,
        assistant_generation_key="test-placeholder",
        assistant_generation_model="test-model",
    )
    payload = asyncio.run(
        g.generate("What are its pods like?", "Acacia auriculiformis", e, depth, s)
    )
    assert len(seen) == 1
    if accepted:
        assert payload["answer"] == " ".join(sentences)
        assert payload["sentences"] == sentences
        assert validate_generated(payload, e, "Acacia auriculiformis") is not None
    else:
        assert payload is None
