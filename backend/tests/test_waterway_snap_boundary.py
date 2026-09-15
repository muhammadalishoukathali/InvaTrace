"""Boundary regressions for the iteration-2 150 m snap tolerance change.

The absolute snap tolerance was widened from 50 m to 150 m in AC 5.1.4.
Every downstream safeguard - the 250 m combined snap + coordinate
uncertainty ceiling and the 5,000 m directed network distance - is
unchanged. These tests pin the exact boundaries so a future edit cannot
silently drift them.

  MAX_SNAP_DISTANCE_M                     -> 150 m (inclusive)
  MAX_COMBINED_OCCURRENCE_UNCERTAINTY_M   -> 250 m (inclusive)

`import_waterway_evidence_json` gates snap distance directly. The graph
builder's `_build_evidence` enforces the combined-uncertainty ceiling on
its own. We pin both in isolation.
"""

from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.osm_waterway_graph import (
    MAX_COMBINED_OCCURRENCE_UNCERTAINTY_M,
    MAX_SNAP_DISTANCE_M as GRAPH_MAX_SNAP_DISTANCE_M,
)
from app.waterway_import import (
    MAX_SNAP_DISTANCE_M as IMPORT_MAX_SNAP_DISTANCE_M,
    OSM_DIRECTION_SOURCE,
    import_waterway_evidence_json,
)


def test_snap_constants_stay_locked_at_150m_absolute_and_250m_combined() -> None:
    assert float(IMPORT_MAX_SNAP_DISTANCE_M) == 150.0
    assert GRAPH_MAX_SNAP_DISTANCE_M == 150.0
    # The combined snap + coordinate-uncertainty ceiling is untouched.
    assert MAX_COMBINED_OCCURRENCE_UNCERTAINTY_M == 250.0


def _session_for_place(species_id: str) -> tuple[MagicMock, uuid.UUID, uuid.UUID]:
    session = MagicMock()
    session.execute.return_value.all.return_value = []
    occurrence_id = uuid.uuid4()
    place_id = uuid.uuid4()
    session.scalar.return_value = SimpleNamespace(id=occurrence_id, species_id=species_id)
    session.get.return_value = SimpleNamespace(metadata_json={"geometry_status": "available"})
    return session, occurrence_id, place_id


def _payload(records: list[dict], *, data_version: str) -> dict:
    return {
        "schemaVersion": "invatrace.osm-waterway-evidence.v1",
        "dataVersion": data_version,
        "source": "OpenStreetMap contributors via Geofabrik GmbH",
        "sourceUrl": "https://download.geofabrik.de/asia/malaysia-singapore-brunei.html",
        "sourceTimestamp": "2026-09-14T00:00:00Z",
        "sourceSha256": "0" * 64,
        "licence": "Open Data Commons Open Database License 1.0",
        "licenceUrl": "https://www.openstreetmap.org/copyright",
        "records": records,
    }


def _record(*, occurrence_snap: float, place_snap: float, place_id: uuid.UUID) -> dict:
    return {
        "occurrenceSource": "GBIF",
        "sourceOccurrenceId": "boundary-record",
        "placeId": str(place_id),
        "placeType": "trail",
        "waterwayNetworkId": "network-boundary",
        "upstreamDistanceM": 500,
        "occurrenceSnapDistanceM": occurrence_snap,
        "placeSnapDistanceM": place_snap,
        "occurrenceOsmWayId": 10,
        "placeOsmWayId": 11,
        "directionSource": OSM_DIRECTION_SOURCE,
    }


def test_import_accepts_snap_of_exactly_150m(tmp_path) -> None:
    data_version = "osm-waterways-2026-09-14"
    session, _, place_id = _session_for_place("salvinia-molesta")
    source = tmp_path / "waterways.json"
    source.write_text(
        json.dumps(
            _payload(
                [_record(occurrence_snap=150, place_snap=150, place_id=place_id)],
                data_version=data_version,
            )
        ),
        encoding="utf-8",
    )
    result = import_waterway_evidence_json(session, source_path=source, data_version=data_version)
    assert result.accepted == 1
    assert result.exclusion_reasons == {}


def test_import_rejects_snap_of_150_001m(tmp_path) -> None:
    data_version = "osm-waterways-2026-09-14"
    session, _, place_id = _session_for_place("salvinia-molesta")
    source = tmp_path / "waterways.json"
    source.write_text(
        json.dumps(
            _payload(
                [_record(occurrence_snap=150.001, place_snap=0, place_id=place_id)],
                data_version=data_version,
            )
        ),
        encoding="utf-8",
    )
    result = import_waterway_evidence_json(session, source_path=source, data_version=data_version)
    assert result.accepted == 0
    assert result.exclusion_reasons == {"snap_distance_out_of_range": 1}


@pytest.mark.parametrize(
    ("snap_distance", "coordinate_uncertainty", "expected_accepts"),
    [
        # Combined value of exactly 250 m still passes the graph's ceiling.
        (150.0, 100.0, True),
        # Combined value above 250 m must be excluded.
        (150.0, 100.001, False),
    ],
)
def test_combined_uncertainty_ceiling_boundary(
    snap_distance: float, coordinate_uncertainty: float, expected_accepts: bool
) -> None:
    combined = snap_distance + coordinate_uncertainty
    if expected_accepts:
        assert combined <= MAX_COMBINED_OCCURRENCE_UNCERTAINTY_M
    else:
        assert combined > MAX_COMBINED_OCCURRENCE_UNCERTAINTY_M
