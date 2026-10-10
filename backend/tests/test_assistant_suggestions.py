"""The scan panel's suggested questions must be answerable without the judge."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.domain.plant_assistant import SupportState, get_retriever

PANEL = Path(__file__).resolve().parents[2] / "src/features/scan/PlantAssistantPanel.tsx"


def panel_source() -> str:
    return PANEL.read_text(encoding="utf-8")


def suggestions() -> list[str]:
    block = re.search(r"const SUGGESTIONS = \[(.*?)\]", panel_source(), re.S).group(1)
    spread = re.search(r"const SPREAD_QUESTION = '([^']+)'", panel_source()).group(1)
    return [
        spread if item.strip() == "SPREAD_QUESTION" else item.strip().strip("'")
        for item in block.split(",")
        if item.strip()
    ]


def spread_species() -> set[str]:
    block = re.search(
        r"SPREAD_DOCUMENTED_SPECIES = new Set\(\[(.*?)\]\)", panel_source(), re.S
    ).group(1)
    return set(re.findall(r"'([^']+)'", block))


def test_spread_species_list_matches_the_knowledge_pack() -> None:
    r = get_retriever()
    assert spread_species() == {s for s in r.species if "spread" in r.covered_topics(s)}


@pytest.mark.parametrize("question", suggestions())
def test_every_offered_suggestion_is_supported_for_every_species(question: str) -> None:
    r = get_retriever()
    for species_id in r.species:
        if question == "How does it spread?" and species_id not in spread_species():
            continue
        state = r.classify(species_id, question, r.search(species_id, question)).state
        assert state == SupportState.DEMONSTRABLY_SUPPORTED, (species_id, question, state)


def test_fallback_depth_uses_only_approved_wording() -> None:
    from app.domain.plant_assistant import fallback_evidence

    r = get_retriever()
    species_id, question = "mikania-micrantha", "How does it spread?"
    evidence = r.classify(species_id, question, r.search(species_id, question)).evidence
    standard, _ = fallback_evidence(r, species_id, evidence, "standard")
    simpler, _ = fallback_evidence(r, species_id, evidence, "simpler")
    detailed, used = fallback_evidence(r, species_id, evidence, "detailed")
    assert len(simpler) < len(standard) < len(detailed)
    # Every part is approved text: whole paragraphs, or a paragraph's opening sentence.
    contents = [c["content"] for c in r.chunks if c["species_id"] == species_id]
    for part in simpler.split("\n\n"):
        assert any(content.startswith(part) for content in contents)
    assert {c["topic"] for c in used} >= {"safe_response"}
    assert all(part in contents for part in detailed.split("\n\n"))


@pytest.mark.parametrize("species_id", list(get_retriever().species))
@pytest.mark.parametrize(
    "what,which",
    [
        ("What plant is this?", "Which plant is this?"),
        ("What is this plant?", "Which is this plant?"),
        ("What habitats does this plant inhabit?", "Which habitats does this plant inhabit?"),
        ("What are its impacts?", "Which are its impacts?"),
        ("What pathways does it spread through?", "Which pathways does it spread through?"),
    ],
)
def test_interrogative_paraphrases_preserve_retrieval_and_support(species_id, what, which):
    retriever = get_retriever()
    baseline = retriever.search(species_id, what)
    paraphrase = retriever.search(species_id, which)
    assert baseline == paraphrase
    first = retriever.classify(species_id, what, baseline)
    second = retriever.classify(species_id, which, paraphrase)
    assert (first.state, first.reason, first.evidence) == (
        second.state,
        second.reason,
        second.evidence,
    )
    if what == "What plant is this?":
        assert first.state == SupportState.DEMONSTRABLY_SUPPORTED
