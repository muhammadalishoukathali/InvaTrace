"""Focused regression checks for the Iteration 2 acceptance-criteria seams."""

from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from starlette.requests import Request

from app.api.routers import reports as reports_router
from app.api.routers.adopted_areas import (
    ActivityMarker,
    _activity_geometry_expression,
    _adoption,
    _comparison_counts,
    _concentrations,
)
from app.api.routers.catalogue import NO_SAFE_ACTION, NO_SEVERITY, catalogue_detail, list_catalogue
from app.api.routers.location import ProtectedLocationContextRequest, _uncertain_context
from app.api.routers.places import _place_metadata, _rank_components
from app.api.routers.reports import (
    RemovalReportRequest,
    _distance_metres,
    _validate_removal_location,
    report_removal,
)
from app.core.errors import ApiProblem
from app.db.models import AuditEvent, SightingStatusEvent
from app.domain.catalogue import load_approved_species
from app.main import create_app
from app.occurrence_import import _approved_species_id, import_occurrence_json
from app.waterway_import import OSM_DIRECTION_SOURCE, import_waterway_evidence_json


def test_closed_catalogue_is_exactly_the_approved_32() -> None:
    records = load_approved_species()
    assert len(records) == 32
    assert len({record.species_id for record in records}) == 32
    names = {record.scientific_name for record in records}
    assert "Ageratina adenophora" not in names
    assert "Lantana camara" not in names
    assert {"Salvinia molesta", "Urochloa mutica", "Pennisetum polystachyum"} <= names


def test_catalogue_search_and_honest_missing_copy() -> None:
    result = list_catalogue(q="  GIANT SALVINIA  ")
    assert [item.species_id for item in result.items] == ["salvinia-molesta"]
    detail = catalogue_detail("salvinia-molesta")
    assert detail.formal_severity_assessment == NO_SEVERITY
    assert detail.safe_response_guidance == [NO_SAFE_ACTION]
    assert NO_SEVERITY == "Formal severity assessment not available"
    assert NO_SAFE_ACTION == "No beginner-safe active action is provided"


def test_catalogue_images_fail_closed_until_full_provenance_is_reviewed() -> None:
    result = list_catalogue(q=None)
    assert all(item.image is None for item in result.items)
    assert catalogue_detail("mikania-micrantha").image is None


def test_boundary_failure_is_never_treated_as_outside() -> None:
    request = ProtectedLocationContextRequest(latitude=3.14, longitude=101.69, accuracyM=250.001)
    response = _uncertain_context(request)
    assert response.context_state == "boundary_uncertain"
    assert response.inside_protected_area is None
    assert response.action_eligible is False
    assert response.permission_confirmation_required is True


def test_removal_distance_gate_uses_metres() -> None:
    assert _distance_metres(3.14, 101.69, 3.14, 101.69) == 0
    radius_m = 6_371_008.8
    longitude_delta = math.degrees(250 / (radius_m * math.cos(math.radians(3.14))))
    at_boundary = _distance_metres(3.14, 101.69, 3.14, 101.69 + longitude_delta)
    outside = _distance_metres(3.14, 101.69, 3.14, 101.69 + longitude_delta * 1.001)
    assert math.isclose(at_boundary, 250, abs_tol=0.001)
    assert outside > 250


def test_removal_location_accepts_250_and_rejects_250_001_accuracy() -> None:
    now = datetime(2026, 9, 13, 0, 0, tzinfo=UTC)
    assert _validate_removal_location(
        captured_at=now - timedelta(minutes=5),
        accuracy_m=250,
        latitude=3.14,
        longitude=101.69,
        sighting_latitude=3.14,
        sighting_longitude=101.69,
        now=now,
    ) == 0
    with pytest.raises(ApiProblem) as raised:
        _validate_removal_location(
            captured_at=now,
            accuracy_m=250.001,
            latitude=3.14,
            longitude=101.69,
            sighting_latitude=3.14,
            sighting_longitude=101.69,
            now=now,
        )
    assert raised.value.code == "removal_accuracy_too_low"


def test_removal_location_rejects_more_than_250m_without_rounding() -> None:
    now = datetime(2026, 9, 13, 0, 0, tzinfo=UTC)
    radius_m = 6_371_008.8
    longitude_delta = math.degrees(250 / (radius_m * math.cos(math.radians(3.14))))
    accepted = _validate_removal_location(
        captured_at=now,
        accuracy_m=10,
        latitude=3.14,
        longitude=101.69 + longitude_delta,
        sighting_latitude=3.14,
        sighting_longitude=101.69,
        now=now,
    )
    assert math.isclose(accepted, 250, abs_tol=0.001)
    with pytest.raises(ApiProblem) as raised:
        _validate_removal_location(
            captured_at=now,
            accuracy_m=10,
            latitude=3.14,
            longitude=101.69 + longitude_delta * 1.001,
            sighting_latitude=3.14,
            sighting_longitude=101.69,
            now=now,
        )
    assert raised.value.code == "removal_too_far"


def _removal_request() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "headers": []})


def test_removal_retry_returns_existing_event_before_revalidating_stale_gps() -> None:
    report_id = uuid.uuid4()
    sighting_id = uuid.uuid4()
    event_time = datetime(2026, 9, 13, 0, 0, tzinfo=UTC)
    report = SimpleNamespace(id=report_id, status="screened")
    sighting = SimpleNamespace(id=sighting_id, status="removal_reported")
    existing = SimpleNamespace(
        report_id=report_id,
        sighting_id=sighting_id,
        created_at=event_time,
        accuracy_m=25.5,
        distance_m=12.25,
    )
    session = MagicMock()
    session.scalar.side_effect = [report, sighting_id, sighting, existing]
    response = report_removal(
        report_id,
        RemovalReportRequest(
            latitude=3.14,
            longitude=101.69,
            accuracy_m=999,
            captured_at=datetime(2020, 1, 1, tzinfo=UTC),
        ),
        _removal_request(),
        SimpleNamespace(profile=SimpleNamespace(id=uuid.uuid4())),
        session,
    )
    assert response.removal_reported_at == event_time
    assert response.accuracy_m == 25.5
    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_removal_submission_appends_private_history_and_preserves_original_report(monkeypatch) -> None:
    now = datetime(2026, 9, 13, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(reports_router, "utcnow", lambda: now)
    profile_id = uuid.uuid4()
    report_id = uuid.uuid4()
    sighting_id = uuid.uuid4()
    report = SimpleNamespace(
        id=report_id,
        status="screened",
        photo_key="evidence/original.jpg",
        species_id="mikania-micrantha",
        latitude=3.14,
        longitude=101.69,
        created_at=now - timedelta(days=10),
    )
    sighting = SimpleNamespace(
        id=sighting_id,
        status="screened",
        species_id="mikania-micrantha",
        latitude=3.14,
        longitude=101.69,
        created_at=now - timedelta(days=10),
    )
    original = {
        "photo_key": report.photo_key,
        "species_id": report.species_id,
        "latitude": report.latitude,
        "longitude": report.longitude,
        "created_at": report.created_at,
    }
    session = MagicMock()
    session.scalar.side_effect = [report, sighting_id, sighting, None]

    def refresh(row) -> None:
        if isinstance(row, SightingStatusEvent):
            row.created_at = now

    session.refresh.side_effect = refresh
    response = report_removal(
        report_id,
        RemovalReportRequest(
            latitude=3.14,
            longitude=101.69,
            accuracy_m=37.125,
            captured_at=now,
        ),
        _removal_request(),
        SimpleNamespace(profile=SimpleNamespace(id=profile_id)),
        session,
    )

    added = [call.args[0] for call in session.add.call_args_list]
    event = next(row for row in added if isinstance(row, SightingStatusEvent))
    audit = next(row for row in added if isinstance(row, AuditEvent))
    assert response.status == "removal_reported"
    assert sighting.status == "removal_reported"
    assert event.acting_profile_id == profile_id
    assert event.accuracy_m == 37.125
    assert float(event.distance_m) == 0
    assert audit.metadata_json["report_id"] == str(report_id)
    assert {field: getattr(report, field) for field in original} == original
    session.commit.assert_called_once_with()


def _marker(
    index: int,
    *,
    latitude: float,
    status: str = "screened",
    observation_date: datetime | None = None,
) -> ActivityMarker:
    now = datetime.now(UTC)
    return ActivityMarker(
        sighting_id=uuid.UUID(int=index + 1),
        species_id="mikania-micrantha",
        scientific_name="Mikania micrantha",
        observation_date=observation_date or now - timedelta(days=1),
        status=status,
        status_date=now,
        latitude=latitude,
        longitude=101.69,
        precision_reduced=False,
    )


def test_recent_concentrations_require_three_active_reports_within_250m() -> None:
    now = datetime.now(UTC)
    markers = [
        _marker(0, latitude=3.1400),
        _marker(1, latitude=3.1405),
        _marker(2, latitude=3.1410),
    ]
    groups = _concentrations(markers, now)
    assert len(groups) == 1
    assert groups[0].report_count == 3
    assert _concentrations(markers[:2], now) == []
    assert (
        _concentrations([*markers[:2], _marker(2, latitude=3.1410, status="removal_reported")], now)
        == []
    )


def test_recent_concentration_does_not_use_single_link_chaining() -> None:
    now = datetime.now(UTC)
    # Roughly 0 m, 200 m and 400 m north: A-B and B-C qualify, A-C does not.
    markers = [
        _marker(0, latitude=3.140000),
        _marker(1, latitude=3.141799),
        _marker(2, latitude=3.143598),
    ]
    assert _concentrations(markers, now) == []


def test_activity_comparison_uses_exact_0_29_and_30_59_day_windows() -> None:
    now = datetime(2026, 9, 13, 0, 0, tzinfo=UTC)
    markers = [
        _marker(0, latitude=3.14, observation_date=now - timedelta(days=29)),
        _marker(1, latitude=3.14, observation_date=now - timedelta(days=30)),
        _marker(2, latitude=3.14, observation_date=now - timedelta(days=59)),
        _marker(3, latitude=3.14, observation_date=now - timedelta(days=60)),
        _marker(4, latitude=3.14, observation_date=now + timedelta(seconds=1)),
    ]
    assert _comparison_counts(markers, now) == (1, 2)


def test_activity_comparison_uses_instants_across_midnight_and_timezone_boundaries() -> None:
    malaysia_time = timezone(timedelta(hours=8))
    now = datetime(2026, 9, 13, 0, 0, tzinfo=UTC)
    markers = [
        _marker(
            0,
            latitude=3.14,
            observation_date=(now - timedelta(days=30, seconds=-1)).astimezone(malaysia_time),
        ),
        _marker(
            1,
            latitude=3.14,
            observation_date=(now - timedelta(days=30)).astimezone(malaysia_time),
        ),
    ]
    assert _comparison_counts(markers, now) == (1, 1)


def test_activity_map_uses_the_same_750m_trail_extent() -> None:
    adoption = SimpleNamespace(place_type="trail", geometry=object())
    expression = _activity_geometry_expression(adoption)
    compiled = str(expression)
    assert "ST_Buffer" in compiled
    assert list(expression.clauses)[1].value == 750


def test_occurrence_species_matching_accepts_only_the_closed_catalogue() -> None:
    assert _approved_species_id({"scientificName": "Brachiaria mutica"}) == "urochloa-mutica"
    assert _approved_species_id({"speciesId": "lantana-camara"}) is None


def test_occurrence_import_rejects_country_coordinate_mismatch(tmp_path) -> None:
    country_path = tmp_path / "malaysia-boundary.json"
    country_path.write_text(
        __import__("json").dumps(
            {
                "type": "Polygon",
                "coordinates": [
                    [[101.0, 2.0], [102.0, 2.0], [102.0, 4.0], [101.0, 4.0], [101.0, 2.0]]
                ],
            }
        ),
        encoding="utf-8",
    )
    records_path = tmp_path / "occurrences.json"
    records_path.write_text(
        __import__("json").dumps(
            [
                {
                    "occurrenceID": "inside",
                    "countryCode": "MY",
                    "occurrenceStatus": "Present",
                    "decimalLatitude": 3.0,
                    "decimalLongitude": 101.5,
                    "coordinateUncertaintyInMeters": 1000,
                    "scientificName": "Mikania micrantha",
                },
                {
                    "occurrenceID": "bbox-only",
                    "countryCode": "MY",
                    "occurrenceStatus": "Present",
                    "decimalLatitude": 1.3,
                    "decimalLongitude": 103.8,
                    "coordinateUncertaintyInMeters": 10,
                    "scientificName": "Mikania micrantha",
                },
            ]
        ),
        encoding="utf-8",
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    result = import_occurrence_json(
        session,
        source_path=records_path,
        source="fixture",
        processed_data_version="fixture-v1",
        country_boundary_path=country_path,
    )
    assert result.accepted == 1
    assert result.exclusion_reasons == {"country_coordinate_mismatch": 1}
    imported = session.add.call_args.args[0]
    assert imported.source_occurrence_id == "inside"


def _waterway_session(*, species_id: str) -> tuple[MagicMock, uuid.UUID, uuid.UUID]:
    session = MagicMock()
    session.execute.return_value.all.return_value = []
    occurrence_id = uuid.uuid4()
    place_id = uuid.uuid4()
    session.scalar.return_value = SimpleNamespace(id=occurrence_id, species_id=species_id)
    session.get.return_value = SimpleNamespace(metadata_json={"geometry_status": "available"})
    return session, occurrence_id, place_id


def test_waterway_import_requires_trusted_direction_and_five_km_limit(tmp_path) -> None:
    session, occurrence_id, place_id = _waterway_session(species_id="salvinia-molesta")
    source_path = tmp_path / "waterways.json"
    source_path.write_text(
        __import__("json").dumps(
            [
                {
                    "occurrenceSource": "GBIF",
                    "sourceOccurrenceId": "gbif-1",
                    "placeId": str(place_id),
                    "placeType": "trail",
                    "waterwayNetworkId": "network-1",
                    "upstreamDistanceM": 5000,
                    "directionSource": OSM_DIRECTION_SOURCE,
                }
            ]
        ),
        encoding="utf-8",
    )
    result = import_waterway_evidence_json(
        session, source_path=source_path, data_version="osm-waterways-2026-09"
    )
    assert result.accepted == 1
    imported = session.add.call_args.args[0]
    assert imported.occurrence_id == occurrence_id
    assert imported.direction_source == OSM_DIRECTION_SOURCE
    assert imported.upstream_distance_m == 5000

    session, _, place_id = _waterway_session(species_id="salvinia-molesta")
    source_path.write_text(
        __import__("json").dumps(
            [
                {
                    "occurrenceSource": "GBIF",
                    "sourceOccurrenceId": "gbif-2",
                    "placeId": str(place_id),
                    "placeType": "trail",
                    "waterwayNetworkId": "network-1",
                    "upstreamDistanceM": 5000.001,
                    "directionSource": "unverified direction",
                }
            ]
        ),
        encoding="utf-8",
    )
    result = import_waterway_evidence_json(
        session, source_path=source_path, data_version="osm-waterways-2026-09"
    )
    assert result.accepted == 0
    assert result.exclusion_reasons == {"untrusted_direction_source": 1}


def test_waterway_import_rejects_non_water_dispersed_species(tmp_path) -> None:
    session, _, place_id = _waterway_session(species_id="acacia-mangium")
    source_path = tmp_path / "waterways.json"
    source_path.write_text(
        __import__("json").dumps(
            [
                {
                    "occurrenceSource": "GBIF",
                    "sourceOccurrenceId": "gbif-3",
                    "placeId": str(place_id),
                    "placeType": "trail",
                    "waterwayNetworkId": "network-1",
                    "upstreamDistanceM": 100,
                    "directionSource": OSM_DIRECTION_SOURCE,
                }
            ]
        ),
        encoding="utf-8",
    )
    result = import_waterway_evidence_json(
        session, source_path=source_path, data_version="osm-waterways-2026-09"
    )
    assert result.accepted == 0
    assert result.exclusion_reasons == {"species_not_water_dispersed": 1}


def test_place_ranking_is_explainable_and_inside_strictly_outranks_nearby() -> None:
    inside = _rank_components(
        inside_count=1,
        nearby_count=0,
        trail_count=0,
        upstream_count=0,
        nearest_distance_m=0,
        radius_m=1000,
        record_count=1,
    )
    strongest_nearby = _rank_components(
        inside_count=0,
        nearby_count=10,
        trail_count=0,
        upstream_count=0,
        nearest_distance_m=0,
        radius_m=1000,
        record_count=10,
    )
    assert inside[-1] > strongest_nearby[-1]
    assert inside[-1] == sum(inside[:-1])


def test_unsupported_place_geometry_is_rejected_with_422() -> None:
    place = SimpleNamespace(metadata_json={"geometry_status": "point_only"})
    with pytest.raises(ApiProblem) as raised:
        _place_metadata(place)
    assert raised.value.status_code == 422
    assert raised.value.code == "unsupported_place_geometry"


def test_private_adoption_lookup_is_owner_scoped() -> None:
    session = MagicMock()
    session.scalar.return_value = None
    with pytest.raises(ApiProblem) as raised:
        _adoption(session, uuid.uuid4(), uuid.uuid4())
    assert raised.value.status_code == 404
    assert raised.value.code == "adoption_not_found"


def test_openapi_exposes_iteration2_routes_and_safe_public_removal_shape() -> None:
    schema = create_app().openapi()
    paths = schema["paths"]
    assert "post" in paths["/api/v1/location-context"]
    assert "post" in paths["/api/v1/reports/{report_id}/removal"]
    assert "get" in paths["/api/v1/catalogue"]
    assert "get" in paths["/api/v1/catalogue/{species_id}"]
    assert "get" in paths["/api/v1/places/{place_id}"]
    assert "get" in paths["/api/v1/places/{place_id}/plant-associations"]
    assert "get" in paths["/api/v1/places/at-location"]
    assert "post" in paths["/api/v1/adopted-areas"]
    assert "201" in paths["/api/v1/adopted-areas"]["post"]["responses"]
    assert "delete" in paths["/api/v1/adopted-areas/{adoption_id}"]
    assert "get" in paths["/api/v1/adopted-areas/{adoption_id}/activity"]
    public_fields = schema["components"]["schemas"]["SightingResponse"]["properties"]
    assert "removalReportedAt" in public_fields
    assert "latitude" not in public_fields
    assert "actingProfileId" not in public_fields
    context_fields = schema["components"]["schemas"]["ProtectedLocationContextResponse"][
        "properties"
    ]
    assert "insideProtectedArea" in context_fields
    removal_accuracy = schema["components"]["schemas"]["RemovalReportRequest"]["properties"][
        "accuracyM"
    ]
    assert removal_accuracy["type"] == "number"
    removal_fields = schema["components"]["schemas"]["RemovalReportResponse"]["properties"]
    assert {"reportId", "sightingId", "status", "removalReportedAt", "accuracyM", "distanceM"} <= set(
        removal_fields
    )
    assert not {"latitude", "longitude", "actingProfileId"} & set(removal_fields)
    place_fields = schema["components"]["schemas"]["PlaceDetail"]["properties"]
    assert {"placeId", "displayName", "placeType", "geometryStatus", "source", "geometry"} <= set(
        place_fields
    )
    association_fields = schema["components"]["schemas"]["PlacePlantAssociationsResponse"][
        "properties"
    ]
    assert {"processedDataVersions", "waterwayDataVersions", "occurrenceUpdatedAt"} <= set(
        association_fields
    )
    ranking_fields = schema["components"]["schemas"]["AssociationEvidence"]["properties"]
    assert {
        "insideComponent",
        "proximityComponent",
        "recordCountComponent",
        "upstreamComponent",
        "rankScore",
    } <= set(ranking_fields)
    adoption_fields = schema["components"]["schemas"]["AdoptAreaResponse"]["properties"]
    assert {"adoptionId", "placeId", "adoptedAt"} <= set(adoption_fields)
    activity_fields = schema["components"]["schemas"]["ActivityMarker"]["properties"]
    assert {"scientificName", "communityLabel", "observationDate", "status", "statusDate"} <= set(
        activity_fields
    )
    catalogue_image_fields = schema["components"]["schemas"]["CatalogueImage"]["properties"]
    assert {
        "url",
        "creator",
        "license",
        "sourceTitle",
        "sourceUrlOrIdentifier",
        "reviewedAt",
    } <= set(catalogue_image_fields)
