"""Explicit public Map context through the shared assistant; all inference mocked."""

import asyncio
import uuid
from unittest.mock import AsyncMock

import pytest
from test_assistant_general_knowledge import ask
from test_assistant_general_knowledge import harness as general_harness

from app.db.base import get_session
from app.services import assistant_general_knowledge as general

harness = general_harness

PUBLIC_ID = str(uuid.UUID(int=101))


@pytest.fixture
def map_harness(harness):
    client, state, settings = harness
    record = {"row": ("mikania-micrantha", "Mikania micrantha"), "sql": []}

    class PublicSession:
        def execute(self, statement):
            record["sql"].append(str(statement.compile(compile_kwargs={"literal_binds": True})))
            return self

        def first(self):
            return record["row"]

    client.app.dependency_overrides[get_session] = lambda: PublicSession()
    yield client, state, settings, record


def map_ask(client, question="Where does it grow?", depth="standard", **extra):
    return client.post(
        "/api/v1/plant-assistant/map/ask",
        json={
            "sightingId": PUBLIC_ID,
            "question": question,
            "depth": depth,
            "allowGeneralKnowledge": True,
            **extra,
        },
    )


def test_map_trusted_mapping_shared_grounding_and_citations(map_harness):
    client, state, _, record = map_harness
    response = map_ask(client, depth="detailed")
    body = response.json()
    assert body["answerMode"] == "grounded" and body["sources"]
    assert [c[0] for c in state["calls"]] == ["generation", "grounding"]
    assert state["calls"][0][1]["depth"] == "detailed"
    assert response.headers["cache-control"] == "private, no-store"
    sql = record["sql"][0]
    assert "species.id, species.latin_name" in sql
    for public in ("screened", "removal_reported", "resolved_after_follow_up"):
        assert public in sql
    for private in ("source_profile_id", "latitude", "longitude", "reports.", "confidence"):
        assert private not in sql
    for _, context, payload in state["calls"]:
        assert PUBLIC_ID not in str(payload)
        assert set(context) <= {
            "species",
            "question",
            "depth",
            "evidence",
            "sentences",
            "used_chunk_ids",
        }


@pytest.mark.parametrize("depth", ["simpler", "standard"])
def test_map_general_allowed_depths(map_harness, depth):
    client, state, _, _ = map_harness
    body = map_ask(client, "What is a rhizome?", depth).json()
    assert body["answerMode"] == "general_knowledge" and body["sources"] == []
    assert [c[0] for c in state["calls"]] == ["general"]
    assert set(state["calls"][0][1]) == {"topic", "question", "depth"}


@pytest.mark.parametrize("question", ["What is a rhizome?", "Why do some plants have waxy leaves?"])
def test_general_detailed_never_calls_judge_or_provider(map_harness, question):
    client, state, _, _ = map_harness
    body = map_ask(client, question, "detailed").json()
    assert body["status"] == "insufficient_evidence" and body["sources"] == []
    assert "Detailed general explanations are not available" in body["answer"]
    assert state["calls"] == state["providers"] == []


@pytest.mark.parametrize(
    "row",
    [
        None,
        ("unknown", "Unknown"),
        ("mikania-micrantha", "Mimosa pigra"),
        ("mikania-micrantha", ""),
    ],
)
def test_unknown_private_unavailable_or_inconsistent_map_record_refuses(map_harness, row):
    client, state, _, record = map_harness
    record["row"] = row
    body = map_ask(client, "What is a rhizome?").json()
    assert body["status"] == "insufficient_evidence" and body["sources"] == []
    assert state["calls"] == []


@pytest.mark.parametrize(
    "extra",
    [
        {"speciesId": "mimosa-pigra"},
        {"classifierConfidence": 0.99},
        {"classifierOutcome": "target"},
        {"latitude": 3.15},
        {"userId": "private"},
        {"scanId": "invented"},
        {"sightingId": None},
        {"sightingId": "fake"},
    ],
)
def test_map_does_not_accept_scan_species_private_or_fake_fields(map_harness, extra):
    client, state, _, record = map_harness
    assert map_ask(client, **extra).status_code == 422
    assert record["sql"] == state["calls"] == []


@pytest.mark.parametrize(
    "question",
    [
        "Is it near me?",
        "Is this plant in Malaysia?",
        "Give me GPS directions to this plant.",
        "Can I eat it?",
        "Can I touch it?",
        "Is it toxic?",
        "Can I remove it?",
        "Can it treat diabetes?",
        "Is removal legal?",
        "May I enter this protected area?",
        "What is a rhizome? My password is private123.",
    ],
)
def test_map_locked_boundaries_never_use_general(map_harness, question):
    client, state, _, _ = map_harness
    body = map_ask(client, question).json()
    assert body["answerMode"] != "general_knowledge"
    assert body["safetyBoundary"].startswith("This assistant does not grant permission")
    if question == "Is this plant in Malaysia?":
        # Existing source-only answerability may check catalogue status;
        # this never authorises independent location claims or general knowledge.
        assert all(c[0] == "judge" for c in state["calls"])
    else:
        assert state["calls"] == []


def test_old_scan_contract_and_confidence_gate_unchanged(harness):
    client, state, _ = harness
    assert (
        client.post(
            "/api/v1/plant-assistant/ask",
            json={
                "speciesId": "mikania-micrantha",
                "question": "What is a rhizome?",
            },
        ).status_code
        == 422
    )
    assert (
        ask(client, "What is a rhizome?", classifierConfidence=0.1).json()["status"]
        == "unsupported_scan"
    )
    assert (
        ask(client, "What is a rhizome?", allowGeneralKnowledge=False).json()["status"]
        == "insufficient_evidence"
    )
    assert state["calls"] == []


def test_general_service_independently_rejects_detailed(harness, monkeypatch):
    _, _, settings = harness
    completion = AsyncMock()
    monkeypatch.setattr(general, "complete", completion)
    assert asyncio.run(general.generate_general("What is a rhizome?", "detailed", settings)) is None
    completion.assert_not_awaited()


def guide_ask(client, question="Where does it grow?", depth="standard", **extra):
    return client.post(
        "/api/v1/plant-assistant/guide/ask",
        json={
            "speciesId": "mikania-micrantha",
            "question": question,
            "depth": depth,
            "allowGeneralKnowledge": True,
            **extra,
        },
    )


def test_guide_uses_public_catalogue_reference_and_preserves_grounded_detailed(harness):
    client, state, _ = harness
    body = guide_ask(client, depth="detailed").json()
    assert body["answerMode"] == "grounded" and body["sources"]
    assert [c[0] for c in state["calls"]] == ["generation", "grounding"]
    assert state["calls"][0][1]["depth"] == "detailed"


@pytest.mark.parametrize("depth", ["simpler", "standard", "detailed"])
def test_guide_general_depth_contract(harness, depth):
    client, state, _ = harness
    body = guide_ask(client, "What is a rhizome?", depth).json()
    assert body["sources"] == []
    if depth == "detailed":
        assert body["status"] == "insufficient_evidence" and state["calls"] == []
    else:
        assert body["answerMode"] == "general_knowledge"
        assert set(state["calls"][0][1]) == {"question", "depth", "topic"}


@pytest.mark.parametrize("species", ["unknown", "Mikania micrantha", "", "mikania-micrantha-extra"])
def test_guide_unknown_or_noncanonical_reference_refuses(harness, species):
    client, state, _ = harness
    response = guide_ask(client, speciesId=species)
    assert response.status_code == 422 or response.json()["status"] == "insufficient_evidence"
    assert state["calls"] == []


@pytest.mark.parametrize(
    "extra", [{"classifierConfidence": 0.95}, {"scanId": "invented"}, {"latitude": 3.15}]
)
def test_guide_never_accepts_fake_scan_or_location(harness, extra):
    client, state, _ = harness
    assert guide_ask(client, **extra).status_code == 422
    assert state["calls"] == []
