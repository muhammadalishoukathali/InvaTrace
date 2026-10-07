"""Frozen source relationships, complete fallback and unchanged hard boundaries."""

import hashlib
import json
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi.testclient import TestClient

from app.api.routers import plant_assistant
from app.config import Settings, get_settings
from app.core.rate_limit import rate_limiter
from app.domain.assistant_safety import supported_safety_evidence
from app.domain.plant_assistant import (
    SAFETY_BOUNDARY,
    SupportState,
    get_retriever,
    protected_chunks,
)
from app.main import create_app

ROOT = Path(__file__).resolve().parents[2]
FROZEN = json.loads((ROOT / "tests/fixtures/epic8_bounded_safety_cases.json").read_text())
REVIEW_FROZEN = json.loads(
    (ROOT / "tests/fixtures/epic8_bounded_safety_review_cases.json").read_text()
)


def test_frozen_cases_and_original_inputs_unchanged():
    assert (
        hashlib.sha256(
            (ROOT / "tests/fixtures/epic8_bounded_safety_cases.json").read_bytes()
        ).hexdigest()
        == REVIEW_FROZEN["original_fixture_sha256"]
    )
    assert (
        hashlib.sha256(
            json.dumps(REVIEW_FROZEN["cases"], sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        == REVIEW_FROZEN["cases_sha256"]
    )
    assert (
        hashlib.sha256(
            json.dumps(FROZEN["cases"], sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        == FROZEN["cases_sha256"]
    )
    for path, digest in FROZEN["protected_sha256"].items():
        # Preserve the original frozen audit input while the user-approved
        # v2 source/hazard work updates the active pack. Labels are untouched.
        original = (
            ROOT / "tests/fixtures/epic8_original_knowledge.json"
            if path == "backend/app/data/plant-assistant-knowledge.json"
            else ROOT / path
        )
        assert hashlib.sha256(original.read_bytes()).hexdigest() == digest
    pack = get_retriever().chunks
    for chunk in FROZEN["reviewed_complete_chunks"]:
        active = next(c for c in pack if c["chunk_id"] == chunk["chunk_id"])
        assert chunk == {k: active[k] for k in chunk}
        assert active["safety_critical"] is True


@pytest.fixture
def safety_client(monkeypatch):
    settings = Settings.model_construct(
        app_env="test", assistant_generation_free_tier=False, assistant_generation_key=None
    )
    monkeypatch.setattr(rate_limiter, "enabled", False)
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize(
    "case", FROZEN["cases"] + REVIEW_FROZEN["cases"], ids=lambda c: c["case_id"]
)
def test_frozen_bounded_safety_api(safety_client, monkeypatch, case):
    retriever = get_retriever()
    search = Mock(wraps=retriever.search)
    generate = AsyncMock(return_value=None)
    monkeypatch.setattr(retriever, "search", search)
    monkeypatch.setattr(plant_assistant, "generate", generate)
    response = safety_client.post(
        "/api/v1/plant-assistant/ask",
        json={
            "speciesId": case["species"],
            "question": case["question"],
            "classifierConfidence": 0.95,
            "classifierOutcome": "target",
            **case.get("request_overrides", {}),
        },
    )
    assert response.status_code == 200
    body = response.json()
    if case["case_id"] == "Q57":
        # Preserve the historical supported label. Causal support now requires
        # independent semantic review, unavailable in this offline fixture.
        candidates = retriever.search(case["species"], case["question"])
        assert (
            retriever.classify(case["species"], case["question"], candidates).state
            == SupportState.NEEDS_SEMANTIC_REVIEW
        )
        assert body["status"] == "insufficient_evidence"
        generate.assert_not_awaited()
        return
    if case["case_id"] == "Q19":
        # Frozen historical label/input remains immutable. Current v2 AC 8.2.6
        # now reports documented hazards without answering YES or granting contact.
        assert body["status"] == "fallback" and body["answerability"] == "answerable"
        assert body["answer"] == "Pollen allergens can cause dermatitis and hay fever."
        assert [s["chunkId"] for s in body["sources"]] == [
            "CAT-parthenium-hysterophorus-hazard-exposure"
        ]
        assert body["safetyBoundary"] == SAFETY_BOUNDARY
        generate.assert_not_awaited()
        return
    assert body["status"] == case["expected_status"]
    assert body["safetyBoundary"] == SAFETY_BOUNDARY
    assert "no-store" in response.headers["cache-control"]
    if case["expected_status"] != "fallback":
        generate.assert_not_awaited()
        if case["expected_status"] == "unsupported_scan" or case["case_id"] == "N40":
            search.assert_not_called()
        return
    if not generate.await_count:
        by_id = {c["chunk_id"]: c for c in retriever.chunks}
        evidence = list({s["chunkId"]: by_id[s["chunkId"]] for s in body["sources"]}.values())
        assert len(protected_chunks(evidence)) == len(evidence)
        generate.assert_not_awaited()
    else:
        generate.assert_awaited_once()
        evidence = generate.call_args.args[2]
    # Source replacement can change TF-IDF rank; require the same complete
    # evidence set, while the assertions below still enforce output ordering.
    assert {c["chunk_id"] for c in evidence} == set(case["expected_chunk_ids"])
    assert body["answer"] == "\n\n".join(c["content"] for c in evidence)
    assert body["sources"] == [
        s.model_dump(by_alias=True) for s in plant_assistant.stored_sources(evidence)
    ]
    assert body["answerability"] == "answerable"


@pytest.mark.parametrize(
    "mutation", ["affirmative", "condition_lost", "foreign", "topic", "zero_score"]
)
def test_safety_exception_requires_the_exact_negative_relation(mutation):
    retriever = get_retriever()
    question = "Can I leave stem pieces on damp ground?"
    original = next(
        c for c in retriever.chunks if c["chunk_id"] == "CAT-mikania-micrantha-safe_response"
    )
    candidate = dict(original, score=1.0)
    if mutation == "affirmative":
        candidate["content"] = candidate["content"].replace("Do not ", "You may ")
    elif mutation == "condition_lost":
        candidate["content"] = candidate["content"].replace(" on moist soil", "")
    elif mutation == "foreign":
        candidate["species_id"] = "acacia-auriculiformis"
    elif mutation == "topic":
        candidate["topic"] = "identification"
    else:
        candidate["score"] = 0
    assert supported_safety_evidence("mikania-micrantha", question, [candidate]) == []
    assert retriever.sufficient("mikania-micrantha", question, [candidate]) == []


def test_matching_words_cannot_substitute_for_a_negative_permission_relation():
    retriever = get_retriever()
    chunk = next(
        c for c in retriever.chunks if c["chunk_id"] == "CAT-acacia-auriculiformis-safe_response"
    )
    candidate = dict(
        chunk, score=1.0, content=chunk["content"].replace("Do not cut", "You may cut")
    )
    assert (
        retriever.sufficient(
            "acacia-auriculiformis", "Can I cut it without permission?", [candidate]
        )
        == []
    )
