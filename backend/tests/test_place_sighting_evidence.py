"""Iteration-2 §4 - community-report evidence pipeline (unit-level).

Full integration coverage lives in the PostGIS suite (needs a running
Postgres). These tests pin the module invariants the pipeline relies on:
  * only screened / removal_reported sightings are eligible,
  * the calculation version is versioned so future rule changes do not
    reuse a stale row,
  * community-report summaries never merge into the historical bucket.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.domain.place_sighting_evidence import (
    COMMUNITY_CALCULATION_VERSION,
    community_report_summaries_for_place,
    refresh_place_sighting_evidence_for_sighting,
)


def _sighting(status: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        status=status,
        species_id="salvinia-molesta",
        latitude=3.14,
        longitude=101.68,
    )


def test_refresh_ignores_non_screened_sightings() -> None:
    session = MagicMock()
    for status in ("candidate", "rejected", "merged", "removed"):
        assert refresh_place_sighting_evidence_for_sighting(session, _sighting(status)) == []
    session.execute.assert_not_called()


def test_calculation_version_is_pinned() -> None:
    # Any change here invalidates every persisted row through the unique
    # constraint on (sighting, place, relation, calc_version). Bump this
    # deliberately when the rules change.
    assert COMMUNITY_CALCULATION_VERSION == "invatrace.place-sighting-evidence.v1"


def test_community_report_source_label_is_fixed() -> None:
    session = MagicMock()
    session.execute.return_value.all.return_value = [
        (
            "salvinia-molesta",
            "screened",
            "inside_boundary",
            12.3,
        ),
        (
            "salvinia-molesta",
            "removal_reported",
            "inside_boundary",
            15.5,
        ),
    ]
    place_id = uuid.uuid4()
    summaries = list(
        community_report_summaries_for_place(
            session, place_id=place_id, place_type="park"
        )
    )
    assert summaries and summaries[0]["speciesId"] == "salvinia-molesta"
    assert summaries[0]["activeReports"] == 1
    assert summaries[0]["removalReports"] == 1
    assert summaries[0]["sourceLabel"] == "Community report - not expert validated"


def test_removed_sightings_stay_excluded_from_active_counts() -> None:
    session = MagicMock()
    session.execute.return_value.all.return_value = [
        (
            "salvinia-molesta",
            "removal_reported",
            "inside_boundary",
            9.9,
        )
    ]
    place_id = uuid.uuid4()
    summaries = list(
        community_report_summaries_for_place(
            session, place_id=place_id, place_type="park", include_removed=False
        )
    )
    # Removal-only rows drop out of the default listing so a removed
    # sighting cannot be paraded as an active community report.
    assert summaries == []
    # Explicitly including removed rows returns the row for audit views.
    included = list(
        community_report_summaries_for_place(
            session, place_id=place_id, place_type="park", include_removed=True
        )
    )
    assert len(included) == 1
    assert included[0]["activeReports"] == 0
    assert included[0]["removalReports"] == 1
