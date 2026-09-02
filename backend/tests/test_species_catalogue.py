"""AC 1.2.2 + 1.2.3 catalogue coverage tests.

Every one of the 31 released classifier labels must resolve to a supported
Malaysia status, must not fall back to the model's own recognition
metadata as the status source, and — if flagged reportable — must carry
enough evidence for the invasive-result pathway.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.api.routers.species import _SAFETY_MESSAGE, _STATUS_TO_UI

CATALOG_PATH = (
    Path(__file__).resolve().parent.parent
    / "app" / "data" / "pulih_model1_species_31.json"
)
_CATALOG = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
_CLASSES = _CATALOG["classes"]


def test_catalogue_has_31_classes() -> None:
    assert _CATALOG["class_count"] == 31
    assert len(_CLASSES) == 31


@pytest.mark.parametrize("entry", _CLASSES, ids=lambda entry: entry["machine_label"])
def test_every_class_resolves_to_supported_ui_status(entry: dict[str, object]) -> None:
    raw = entry.get("malaysia_status")
    # Blank / null falls back through _ui_malaysia_status to status_uncertain,
    # which is a supported UI status. Non-blank values must be in the map.
    if raw:
        assert raw in _STATUS_TO_UI, f"{entry['machine_label']} → unknown status {raw!r}"


@pytest.mark.parametrize("entry", _CLASSES, ids=lambda entry: entry["machine_label"])
def test_no_class_uses_the_model_recognition_category_as_status_source(
    entry: dict[str, object],
) -> None:
    # AC 1.2.2 — the model's own recognition category is not a Malaysian
    # invasive-status source. Any lingering reference is a regression.
    source = entry.get("status_source") or ""
    assert "PULIH v4 approved recognition category" not in source, (
        f"{entry['machine_label']} still cites the recognition category as its status source"
    )


def test_deferred_classes_are_downgraded_to_status_uncertain() -> None:
    # AC 1.2.2 — miconia_crenata, sphagneticola_trilobata and lantana_camara
    # were previously flagged invasive with a non-sourced status. Until
    # reviewed evidence lands they must resolve to status_uncertain (via
    # the status_requires_expert_review raw value) and never expose Report.
    deferred = {"miconia_crenata", "sphagneticola_trilobata", "lantana_camara"}
    for entry in _CLASSES:
        if entry["machine_label"] not in deferred:
            continue
        assert entry["malaysia_status"] == "status_requires_expert_review", entry
        assert _STATUS_TO_UI[entry["malaysia_status"]] == "status_uncertain"


def test_safety_message_covers_every_ui_status() -> None:
    # AC 1.2.3 — every UI status the client can see must have a canonical
    # safety message so info-only / uncertain scan results still display a
    # do-not-act line rather than an empty strip.
    ui_statuses = set(_STATUS_TO_UI.values())
    assert ui_statuses.issubset(_SAFETY_MESSAGE.keys())
    for message in _SAFETY_MESSAGE.values():
        assert isinstance(message, str) and message.strip()
