"""Current v2 requirements, separate from immutable historical audit labels."""

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers import plant_assistant
from app.config import Settings, get_settings
from app.core.rate_limit import rate_limiter
from app.domain.plant_assistant import EvidenceRetriever, get_retriever

ROOT = Path(__file__).resolve().parents[2]
REVIEWED = json.loads((ROOT / "data/assistant-reviewed-evidence.json").read_text())


@pytest.fixture
def latest_client(monkeypatch):
    settings = Settings.model_construct(
        assistant_generation_free_tier=False,
        assistant_generation_key=None,
        assistant_generation_model=None,
    )
    monkeypatch.setattr(rate_limiter, "enabled", False)
    app = FastAPI()
    app.include_router(plant_assistant.router)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as client:
        yield client


def ask(client, question, species="mikania-micrantha", **extra):
    response = client.post(
        "/api/v1/plant-assistant/ask",
        json={
            "speciesId": species,
            "classifierConfidence": 0.95,
            "classifierOutcome": "target",
            "question": question,
            **extra,
        },
    )
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("entry", REVIEWED["spread"], ids=lambda e: e["species_id"])
def test_reviewed_spread_replaces_templates(latest_client, entry):
    body = ask(latest_client, "Does it spread by water?", entry["species_id"])
    assert body["status"] == "fallback" and body["answerability"] == "answerable"
    assert entry["content"] in body["answer"]
    assert entry["chunk_id"] in {s["chunkId"] for s in body["sources"]}
    assert not body["answer"].startswith("The approved catalogue records water")
    assert entry["evidence_status"] == "reviewed"
    assert all(s["license"] == "CC BY 4.0" for s in entry["sources"])
    unsupported = ask(latest_client, "Does it spread by teleportation?", entry["species_id"])
    assert unsupported["status"] == "insufficient_evidence"


@pytest.mark.parametrize("status", ["placeholder", "pending", "excluded", "reviewed"])
def test_old_placeholder_cannot_independently_establish_an_answer(status):
    # Reintroduce the complete old paragraph and plausible source metadata.
    # Even a mistaken 'reviewed' label cannot resurrect this known template.
    chunk = dict(
        get_retriever().chunks[0],
        topic="spread",
        evidence_status=status,
        content="The approved catalogue records water as a spread pathway for this plant. It does not describe every spread pathway.",
    )
    retriever = EvidenceRetriever([chunk])
    candidates = retriever.search(chunk["species_id"], "Does it spread by water?")
    assert not candidates
    assert not retriever.sufficient(
        chunk["species_id"], "Does it spread by water?", [dict(chunk, score=1)]
    )


def test_no_placeholder_in_runtime_pack():
    pack = get_retriever()
    assert len(pack.species) == 32
    assert all(
        not c["content"].startswith("The approved catalogue records water") for c in pack.chunks
    )
    assert all(
        "cabi.org" not in s["url"]
        for c in pack.chunks
        if c["topic"] == "spread"
        for s in c["sources"]
    )


@pytest.mark.parametrize(
    "question",
    [
        "Does it spread by water?",
        "Where does it grow?",
        "What does it look like?",
        "What are its main visual clues?",
        "What are its main visual clues and how does it spread?",
        "What can I do safely when permission is unknown?",
    ],
)
def test_supported_aspects(latest_client, question):
    body = ask(latest_client, question)
    assert body["status"] == "fallback" and body["sources"]


@pytest.mark.parametrize(
    "question",
    [
        "When does it flower?",
        "What is its flowering season?",
        "In which month does it flower?",
        "Does it grow near me?",
        "Where does it grow nearby?",
        "Does it grow in my area?",
        "Is it safe?",
        "Is it safe to touch?",
        "Is it harmless?",
        "Is it safe to handle?",
        "Does it mainly spread by water?",
        "What is its primary spread pathway?",
    ],
)
def test_unsupported_aspects_never_reach_generation(latest_client, monkeypatch, question):
    async def forbidden(*args, **kwargs):
        pytest.fail("Unsupported aspect must not reach any generation provider")

    monkeypatch.setattr(plant_assistant, "generate", forbidden)
    body = ask(latest_client, question)
    assert body["status"] == "insufficient_evidence"
    assert body["answerability"] == "insufficient_evidence"


@pytest.mark.parametrize(
    "species,question,ids",
    [
        (
            "asclepias-curassavica",
            "Is it safe to touch?",
            ["CAT-asclepias-curassavica-hazard-contact"],
        ),
        (
            "asclepias-curassavica",
            "Is it harmful to handle?",
            ["CAT-asclepias-curassavica-hazard-contact"],
        ),
        (
            "asclepias-curassavica",
            "Is it poisonous?",
            ["CAT-asclepias-curassavica-hazard-ingestion"],
        ),
        (
            "asclepias-curassavica",
            "Is Asclepias curassavica safe?",
            [
                "CAT-asclepias-curassavica-hazard-contact",
                "CAT-asclepias-curassavica-hazard-ingestion",
            ],
        ),
        (
            "parthenium-hysterophorus",
            "Is it safe to touch this plant?",
            ["CAT-parthenium-hysterophorus-hazard-exposure"],
        ),
        (
            "parthenium-hysterophorus",
            "Is it safe?",
            ["CAT-parthenium-hysterophorus-hazard-exposure"],
        ),
        (
            "rottboellia-cochinchinensis",
            "Can I handle it?",
            ["CAT-rottboellia-cochinchinensis-hazard-contact"],
        ),
    ],
)
def test_documented_hazard_only(latest_client, monkeypatch, species, question, ids):
    async def forbidden(*args):
        pytest.fail("Hazard statements are deterministic; no provider required")

    monkeypatch.setattr(plant_assistant, "generate", forbidden)
    body = ask(latest_client, question, species)
    records = {r["chunk_id"]: r for r in REVIEWED["hazards"]}
    assert body["status"] == "fallback" and body["answerability"] == "answerable"
    assert body["answer"] == "\n\n".join(records[i]["content"] for i in ids)
    assert [s["chunkId"] for s in body["sources"]] == ids
    assert all(
        s["sourceUrl"] == records[s["chunkId"]]["sources"][0]["url"] for s in body["sources"]
    )
    assert "does not grant permission" in body["safetyBoundary"]


@pytest.mark.parametrize(
    "species,question",
    [
        ("mikania-micrantha", "Is it safe?"),
        ("mikania-micrantha", "Is it poisonous?"),
        ("mikania-micrantha", "Is it safe to handle?"),
        ("parthenium-hysterophorus", "Is it safe to eat?"),
        ("rottboellia-cochinchinensis", "Is it toxic?"),
    ],
)
def test_no_scoped_hazard_is_not_safety(latest_client, species, question):
    body = ask(latest_client, question, species)
    assert body["status"] == "insufficient_evidence"
    assert body["answer"].startswith("The reviewed sources do not document this hazard.")
    assert (
        "does not establish" in body["answer"]
        and "does not grant permission" in body["safetyBoundary"]
    )


@pytest.mark.parametrize(
    "question",
    [
        "What medicine should I use after touching it?",
        "Does it harm my dog?",
        "Is it safe for children?",
        "Can I touch it and then remove it?",
        "Can I touch it and then photograph it?",
        "Can I handle it if I have permission?",
        "Is it safe to touch and where does it grow?",
        "Is it safe to enter a protected area to collect it?",
    ],
)
def test_hazard_cannot_answer_medical_or_permission_compounds(latest_client, question):
    body = ask(latest_client, question, "parthenium-hysterophorus")
    assert body["status"] == "insufficient_evidence"
    assert not body["answer"].startswith("The reviewed sources do not document this hazard.")


@pytest.mark.parametrize(
    "species,question,has_sources,has_spread,has_hazards",
    [
        ("mikania-micrantha", "When does it flower?", True, True, False),
        ("mikania-micrantha", "ZXQVVJ", False, True, False),
        ("asclepias-curassavica", "When does it flower?", True, False, True),
        ("acacia-auriculiformis", "Does it spread by water?", True, False, False),
        ("mikania-micrantha", "Is it safe?", True, True, False),
    ],
)
def test_insufficient_lists_only_runtime_coverage(
    latest_client, species, question, has_sources, has_spread, has_hazards
):
    body = ask(latest_client, question, species)
    assert body["status"] == "insufficient_evidence"
    assert bool(body["sources"]) == has_sources
    assert {"identification", "habitat", "impact", "safe_response"}.issubset(body["coveredTopics"])
    assert ("spread" in body["coveredTopics"]) == has_spread
    assert ("documented_hazards" in body["coveredTopics"]) == has_hazards
    assert len(body["coveredTopics"]) == len(set(body["coveredTopics"]))


@pytest.mark.parametrize(
    "species,extra",
    [
        ("unknown", {}),
        (None, {}),
        ("mikania-micrantha", {"classifierOutcome": "other_plant"}),
        ("mikania-micrantha", {"classifierOutcome": "uncertain"}),
        ("mikania-micrantha", {"classifierConfidence": 0.1}),
    ],
)
def test_unsupported_scan_has_no_species_coverage(latest_client, species, extra):
    body = ask(latest_client, "When does it flower?", species, **extra)
    assert (
        body["status"] == "unsupported_scan"
        and body["coveredTopics"] == []
        and body["sources"] == []
    )


def test_coverage_excludes_unreviewed_and_legacy_templates():
    original = get_retriever().chunks[0]
    chunks = [
        dict(original, topic="spread", evidence_status="pending"),
        dict(
            original,
            chunk_id="legacy",
            topic="spread",
            content="The approved catalogue records water as a spread pathway",
        ),
    ]
    assert EvidenceRetriever(chunks).covered_topics(original["species_id"]) == []


def test_reviewed_attribution_survives_api_mapping(latest_client):
    body = ask(latest_client, "Does it spread by water?")
    source = next(s for s in body["sources"] if s["chunkId"] == "CAT-mikania-micrantha-spread")
    entry = next(e for e in REVIEWED["spread"] if e["species_id"] == "mikania-micrantha")
    assert source["attribution"] == entry["sources"][0]["attribution"]
    assert source["sourceLicense"] == "CC BY 4.0"
    assert source["sourceLicenseUrl"] == entry["sources"][0]["license_url"]


@pytest.mark.parametrize(
    "species,question,expected",
    [
        ("mikania-micrantha", "Can I leave stem pieces on damp ground?", "fallback"),
        ("mikania-micrantha", "Can I photograph it without disturbing it?", "fallback"),
        ("acacia-auriculiformis", "Can I cut it without site permission?", "fallback"),
        ("asclepias-curassavica", "How should I respond safely?", "fallback"),
        ("eichhornia-crassipes", "Can I enter the water to remove it?", "fallback"),
        ("mikania-micrantha", "Can I remove it?", "insufficient_evidence"),
        (
            "mikania-micrantha",
            "Can I enter a protected area to collect it?",
            "insufficient_evidence",
        ),
        (
            "mikania-micrantha",
            "Can I leave stem pieces on dry ground instead?",
            "insufficient_evidence",
        ),
        (
            "acacia-auriculiformis",
            "Can I cut it if I have site permission?",
            "insufficient_evidence",
        ),
        ("asclepias-curassavica", "Can I handle it if I have permission?", "insufficient_evidence"),
        (
            "mikania-micrantha",
            "Should I burn it instead of leaving fragments on moist soil?",
            "insufficient_evidence",
        ),
        (
            "mikania-micrantha",
            "If I satisfy all conditions, may I remove it?",
            "insufficient_evidence",
        ),
    ],
)
def test_team_control_interpretation(latest_client, species, question, expected):
    body = ask(latest_client, question, species)
    assert body["status"] == expected
    assert "does not grant permission" in body["safetyBoundary"]
    if expected == "fallback":
        r = get_retriever()
        evidence = r.sufficient(species, question, r.search(species, question))
        assert body["answer"] == "\n\n".join(c["content"] for c in evidence)
        assert body["sources"] == [
            s.model_dump(by_alias=True) for s in plant_assistant.stored_sources(evidence)
        ]
        assert any(
            phrase in body["answer"]
            for phrase in ["Do not", "Never", "without disturbing", "permission"]
        )
    else:
        assert body["answerability"] == "insufficient_evidence"
