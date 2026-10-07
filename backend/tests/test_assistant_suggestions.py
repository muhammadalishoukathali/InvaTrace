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
    return [spread if item.strip() == "SPREAD_QUESTION" else item.strip().strip("'")
            for item in block.split(",") if item.strip()]


def spread_species() -> set[str]:
    block = re.search(r"SPREAD_DOCUMENTED_SPECIES = new Set\(\[(.*?)\]\)", panel_source(), re.S).group(1)
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
