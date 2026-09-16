"""AC Iteration 1 P1 - shared/catalogue coverage tests.

Every one of the released classifier labels must resolve to exactly one
plant-status record with a supported ui_state. Iteration 2 replaced the
earlier 31-class catalogue (which required three ``status_uncertain``
placeholders) with the closed 32-species Iteration 2 allowlist; the
previously deferred classes (``miconia_crenata``, ``sphagneticola_trilobata``,
``lantana_camara``) are now intentionally absent from the shared catalogue.
"""

from __future__ import annotations

import pytest

from app.api.routers.species import _SAFETY_MESSAGE, _STATUS_TO_UI
from app.domain.catalogue import (
    VALID_UI_STATES,
    load_approved_species,
    load_manifest,
    load_status_records,
    status_record_for_model_label,
    verify_disk_checksums,
)

_RECORDS = load_status_records()


def test_catalogue_has_expected_class_count() -> None:
    manifest = load_manifest()
    assert len(_RECORDS) == 32, "shared catalogue must contain 32 plant-status records"
    assert manifest.plant_status_sha256, "manifest must record a sha256 for plant-status.json"


def test_iteration_2_allowlist_has_exactly_32_unique_species() -> None:
    records = load_approved_species()
    assert len(records) == 32
    assert len({record.species_id for record in records}) == 32
    assert "ageratina-adenophora" not in {record.species_id for record in records}


def test_manifest_checksums_match_disk() -> None:
    # If this fails, run `node scripts/update-catalogue-manifest.mjs` and commit
    # the regenerated manifest.
    verify_disk_checksums()


@pytest.mark.parametrize("record", _RECORDS, ids=lambda r: r.model_label)
def test_every_record_has_a_valid_ui_state(record) -> None:
    assert record.ui_state in VALID_UI_STATES
    assert record.ui_state in _STATUS_TO_UI


@pytest.mark.parametrize("record", _RECORDS, ids=lambda r: r.model_label)
def test_report_eligible_flag_matches_ui_state(record) -> None:
    if record.ui_state == "invasive":
        assert record.report_eligible is True
        assert record.status_source_ids, (
            f"{record.model_label!r} is invasive but cites no reviewed source"
        )
    else:
        assert record.report_eligible is False


def test_deferred_classes_are_absent_from_iteration_2_catalogue() -> None:
    # The three Iteration 1 model labels that only had the model's own
    # recognition category as evidence were excluded from the closed
    # Iteration 2 32-species allowlist rather than kept as
    # ``status_uncertain`` placeholders. Confirm they no longer resolve.
    for label in ("miconia_crenata", "sphagneticola_trilobata", "lantana_camara"):
        assert status_record_for_model_label(label) is None, (
            f"{label!r} must not appear in the Iteration 2 shared catalogue"
        )


def test_safety_message_covers_every_ui_status() -> None:
    ui_statuses = set(_STATUS_TO_UI.values())
    assert ui_statuses.issubset(_SAFETY_MESSAGE.keys())
    for message in _SAFETY_MESSAGE.values():
        assert isinstance(message, str) and message.strip()
