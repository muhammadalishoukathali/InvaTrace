"""Domain-level tests for app.domain.action_guidance.

Covers AC 3.1.1 (safe observe-and-report fallback for missing guides), AC
3.1.4 (fallback carries stable version + prohibited-action fields so the
frontend can display provenance), and AC 3.2.3 (prohibited actions never
leak into the returned steps).
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.domain.action_guidance import (
    _observe_and_report_fallback,
    current_action_guide,
)


def _stub_species(**overrides) -> SimpleNamespace:
    """Minimal Species-like stub - SQLAlchemy models are heavy to spin up
    for pure-function tests."""

    defaults = dict(
        id="mikania-micrantha",
        guidance_metadata={
            "sources": [
                {"id": "src-1", "title": "Test source", "publisher": "InvaTrace"}
            ],
            "stop_conditions": ["A stop condition applies here."],
            "spread_prevention": ["Bag fragments before transport."],
            "prohibited_actions": ["Do not apply broadcast herbicide."],
        },
        guidance_content_version="v1.0",
        guidance_last_reviewed=datetime(2026, 1, 1, tzinfo=UTC),
        action_guides=[],
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_observe_and_report_fallback_is_report_only() -> None:
    guide = _observe_and_report_fallback(_stub_species())
    assert guide.guidance_mode == "report_only"
    assert guide.action_mode == "report_only"
    assert guide.steps == []
    assert "Do not attempt removal without reviewed guidance" in guide.do_not_do


def test_observe_and_report_fallback_preserves_provenance() -> None:
    guide = _observe_and_report_fallback(_stub_species())
    assert guide.content_version == "v1.0"
    assert guide.last_reviewed is not None
    assert [source.id for source in guide.sources] == ["src-1"]
    assert guide.spread_prevention == ["Bag fragments before transport."]
    assert guide.prohibited_actions == ["Do not apply broadcast herbicide."]


def test_current_action_guide_falls_back_when_no_guide_matches_month() -> None:
    # No action_guides + non-matching month → observe-and-report fallback.
    guide = current_action_guide(
        _stub_species(), observed_at=datetime(2026, 6, 15, tzinfo=UTC)
    )
    assert guide is not None
    assert guide.guidance_mode == "report_only"
    assert guide.plant_id == "mikania-micrantha"


def test_current_action_guide_selects_month_matched_guide() -> None:
    species = _stub_species(
        action_guides=[
            {
                "title": "Dry season removal",
                "summary": "Cut back stems and bag fragments.",
                "validMonths": [1, 2, 3],
                "actionMode": "active_guidance",
                "guidanceMode": "active_guidance",
                "steps": [{"order": 1, "action": "Cut stems", "safe": True}],
                "revision": "dry-v1",
                "sources": [
                    {"id": "src-1", "title": "Test source", "publisher": "InvaTrace"}
                ],
            }
        ]
    )
    guide = current_action_guide(species, observed_at=datetime(2026, 2, 1, tzinfo=UTC))
    assert guide is not None
    assert guide.guidance_mode == "active_guidance"
    assert guide.title == "Dry season removal"
    assert guide.revision == "dry-v1"


@pytest.mark.parametrize(
    "guidance_mode",
    ["active_guidance", "site_manager_confirmation_required", "report_only"],
)
def test_guidance_modes_all_valid(guidance_mode: str) -> None:
    # AC 3.1.3 - every guidance mode from the AC set must round-trip through
    # the SeasonalActionGuide schema without validation errors.
    species = _stub_species(
        action_guides=[
            {
                "title": "Test",
                "summary": "Test",
                "validMonths": list(range(1, 13)),
                "actionMode": guidance_mode,
                "guidanceMode": guidance_mode,
                "steps": [],
                "revision": "test-v1",
                "sources": [
                    {"id": "src-1", "title": "Test source", "publisher": "InvaTrace"}
                ],
            }
        ]
    )
    guide = current_action_guide(species)
    assert guide is not None
    assert guide.guidance_mode == guidance_mode
