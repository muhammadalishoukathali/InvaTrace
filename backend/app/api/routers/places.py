"""Place details and evidence-based plant associations for Iteration 2."""

from __future__ import annotations

import json
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from geoalchemy2 import Geography, Geometry
from sqlalchemy import and_, cast, func, or_, select
from sqlalchemy.orm import Session

from app.api.routers.location import _classify_area
from app.api.schemas import ApiModel
from app.core.errors import ApiProblem
from app.db.base import get_session
from app.db.models import (
    MonitoredArea,
    OccurrenceRecord,
    PlaceOccurrenceWaterwayEvidence,
    Species,
    Trail,
    WaterwayDataset,
)
from app.domain.catalogue import (
    approved_catalogue_image_for_species,
    approved_species_record,
)
from app.waterway_import import MAX_SNAP_DISTANCE_M, OSM_DIRECTION_SOURCE

router = APIRouter(prefix="/api/v1/places", tags=["places"])

PlaceType = Literal["park", "forest", "wood", "trail"]
EvidenceType = Literal["inside_boundary", "nearby_buffer", "trail_buffer", "upstream"]
MALAYSIA_MIN_LON = 99.3
MALAYSIA_MIN_LAT = 0.8
MALAYSIA_MAX_LON = 119.5
MALAYSIA_MAX_LAT = 7.5
PLACE_MAP_MAX_RESULTS = 2_000
ASSOCIATION_MAX_ROWS = 5_000
# PostGIS geography can report ST_Distance=1000 while ST_DWithin(..., 1000)
# is false by a sub-millimetre floating-point residue. This tolerance keeps
# the AC's inclusive 1,000 m / 750 m boundary without widening it materially.
SPATIAL_BOUNDARY_EPSILON_M = 0.001


class PlaceSummary(ApiModel):
    place_id: uuid.UUID
    display_name: str
    place_type: PlaceType
    geometry_status: str
    source: str
    geometry_version: str
    view_plants_url: str


class PlaceDetail(ApiModel):
    place_id: uuid.UUID
    display_name: str
    place_type: PlaceType
    geometry_status: str
    source: str
    geometry_version: str
    geometry: dict
    view_plants_url: str


class PlaceListResponse(ApiModel):
    items: list[PlaceSummary]


class PlaceMapFeatureProperties(ApiModel):
    place_id: uuid.UUID
    display_name: str
    place_type: PlaceType
    geometry_status: Literal["available"]
    source: str
    geometry_version: str


class PlaceMapFeature(ApiModel):
    type: Literal["Feature"] = "Feature"
    id: uuid.UUID
    geometry: dict
    properties: PlaceMapFeatureProperties


class PlaceMapResponse(ApiModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[PlaceMapFeature]
    truncated: bool
    max_results: int = PLACE_MAP_MAX_RESULTS


class PlaceAtLocationResponse(ApiModel):
    place: PlaceDetail | None


class AssociationEvidence(ApiModel):
    types: list[EvidenceType]
    inside_count: int
    nearby_count: int
    trail_count: int
    upstream_count: int
    nearest_distance_m: float
    inside_component: float
    proximity_component: float
    record_count_component: float
    upstream_component: float
    rank_score: float


class PlacePlantAssociation(ApiModel):
    species_id: str
    scientific_name: str
    common_names: list[str]
    malaysia_status: Literal["Present"]
    image_url: str | None
    occurrence_count: int
    most_recent_year: int | None
    evidence: AssociationEvidence
    catalogue_url: str


class CommunityReportEvidence(ApiModel):
    """Iteration-2 §4 community-report tier.

    Community sightings are ALWAYS reported in a separately labelled tier
    from ``items`` (which carries the reviewed historical GBIF records).
    ``source_label`` is fixed to make the difference visible in the UI and
    in downstream analytics; do not merge these counts into
    ``occurrence_count`` on a historical row.
    """

    species_id: str
    scientific_name: str
    common_names: list[str]
    active_reports: int
    removal_reports: int
    relations: list[str]
    nearest_distance_m: float | None
    catalogue_url: str
    source_label: Literal["Community report - not expert validated"] = (
        "Community report - not expert validated"
    )


class PlacePlantAssociationsResponse(ApiModel):
    place_id: uuid.UUID
    place_name: str
    place_type: PlaceType
    geometry_version: str
    processed_data_versions: list[str]
    waterway_data_versions: list[str]
    occurrence_updated_at: datetime | None
    disclaimer: str
    truncated: bool
    # Historical GBIF-derived evidence (the reviewed record system). Also
    # aliased as ``historical_records`` for readers that expect that name
    # directly - both fields serialize the same value.
    items: list[PlacePlantAssociation]
    community_reports: list[CommunityReportEvidence] = []


def _metadata(value) -> dict:
    return value.metadata_json or {}


def _place(session: Session, place_id: uuid.UUID) -> tuple[MonitoredArea | Trail, PlaceType]:
    area = session.get(MonitoredArea, place_id)
    if area is not None:
        return area, _classify_area(area.name, _metadata(area))
    trail = session.get(Trail, place_id)
    if trail is not None:
        return trail, "trail"
    raise ApiProblem(404, "place_not_found", "Not found")


def _place_metadata(place: MonitoredArea | Trail) -> tuple[str, str, str]:
    metadata = _metadata(place)
    geometry_status = str(metadata.get("geometry_status") or "available")
    if geometry_status != "available":
        raise ApiProblem(
            422,
            "unsupported_place_geometry",
            "This place does not have supported polygon or trail geometry.",
        )
    source = str(metadata.get("source") or "OpenStreetMap")
    version = str(metadata.get("geometry_version") or metadata.get("source_date") or "unversioned")
    return geometry_status, source, version


def _reference_image_url(species_id: str) -> str | None:
    image = approved_catalogue_image_for_species(species_id)
    return image.url if image is not None else None


def _summary(
    place_id: uuid.UUID,
    name: str,
    metadata: dict,
    place_type: PlaceType,
) -> PlaceSummary | None:
    geometry_status = str(metadata.get("geometry_status") or "available")
    if geometry_status != "available":
        return None
    source = str(metadata.get("source") or "OpenStreetMap")
    geometry_version = str(
        metadata.get("geometry_version") or metadata.get("source_date") or "unversioned"
    )
    return PlaceSummary(
        place_id=place_id,
        display_name=name,
        place_type=place_type,
        geometry_status=geometry_status,
        source=source,
        geometry_version=geometry_version,
        view_plants_url=f"/places/{place_id}",
    )


def _stored_geometry(place_id: uuid.UUID, place_type: PlaceType):
    model = Trail if place_type == "trail" else MonitoredArea
    return select(model.geometry).where(model.id == place_id).scalar_subquery()


def _rank_components(
    *,
    inside_count: int,
    nearby_count: int,
    trail_count: int,
    upstream_count: int,
    nearest_distance_m: float,
    radius_m: int,
    record_count: int,
) -> tuple[float, float, float, float, float]:
    """Return explicit, reproducible evidence-ranking components."""
    inside_component = 4.0 if inside_count else 0.0
    has_nearby_evidence = bool(nearby_count or trail_count)
    proximity_component = (
        max(0.0, 2.0 * (1 - nearest_distance_m / radius_m))
        if not inside_count and has_nearby_evidence
        else 0.0
    )
    record_count_component = min(1.0, record_count / 10)
    upstream_component = 0.75 if upstream_count else 0.0
    total = inside_component + proximity_component + record_count_component + upstream_component
    return (
        inside_component,
        proximity_component,
        record_count_component,
        upstream_component,
        total,
    )


def _place_detail_response(
    session: Session,
    place: MonitoredArea | Trail,
    place_type: PlaceType,
) -> PlaceDetail:
    geometry_status, source, geometry_version = _place_metadata(place)
    stored_geometry = _stored_geometry(place.id, place_type)
    geojson_raw = session.scalar(
        select(func.ST_AsGeoJSON(cast(stored_geometry, Geometry(srid=4326))))
    )
    if not geojson_raw:
        raise ApiProblem(422, "unsupported_place_geometry", "This place has no usable geometry.")
    return PlaceDetail(
        place_id=place.id,
        display_name=place.name,
        place_type=place_type,
        geometry_status=geometry_status,
        source=source,
        geometry_version=geometry_version,
        geometry=json.loads(geojson_raw),
        view_plants_url=f"/places/{place.id}",
    )


@router.get("", response_model=PlaceListResponse)
def list_places(session: Session = Depends(get_session)) -> PlaceListResponse:
    """Return searchable place metadata without expensive full geometries."""
    items: list[PlaceSummary] = []
    area_rows = session.execute(
        select(
            MonitoredArea.id,
            MonitoredArea.name,
            MonitoredArea.metadata_json,
        ).order_by(MonitoredArea.name)
    ).all()
    for place_id, name, metadata in area_rows:
        item = _summary(place_id, name, metadata or {}, _classify_area(name, metadata or {}))
        if item is not None:
            items.append(item)
    trail_rows = session.execute(
        select(Trail.id, Trail.name, Trail.metadata_json).order_by(Trail.name)
    ).all()
    for place_id, name, metadata in trail_rows:
        item = _summary(place_id, name, metadata or {}, "trail")
        if item is not None:
            items.append(item)
    items.sort(key=lambda item: item.display_name.casefold())
    return PlaceListResponse(items=items)


def _validate_viewport(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> None:
    if min_lon >= max_lon or min_lat >= max_lat:
        raise ApiProblem(422, "invalid_viewport", "Viewport minimums must be below maximums.")
    if not (
        MALAYSIA_MIN_LON <= min_lon <= MALAYSIA_MAX_LON
        and MALAYSIA_MIN_LON <= max_lon <= MALAYSIA_MAX_LON
        and MALAYSIA_MIN_LAT <= min_lat <= MALAYSIA_MAX_LAT
        and MALAYSIA_MIN_LAT <= max_lat <= MALAYSIA_MAX_LAT
    ):
        raise ApiProblem(422, "viewport_outside_malaysia", "Viewport must be within Malaysia bounds.")


def _available_geometry(model):
    # The map endpoint is deliberately stricter than legacy detail lookup:
    # missing metadata is not proof that a geometry completed validation.
    return model.metadata_json["geometry_status"].as_string() == "available"


def _area_type_filter(requested_types: set[PlaceType]):
    landuse = func.coalesce(
        MonitoredArea.metadata_json["tags"]["landuse"].as_string(),
        MonitoredArea.metadata_json["landuse"].as_string(),
        "",
    )
    natural = func.coalesce(
        MonitoredArea.metadata_json["tags"]["natural"].as_string(),
        MonitoredArea.metadata_json["natural"].as_string(),
        "",
    )
    predicates = []
    if "forest" in requested_types:
        predicates.append(landuse == "forest")
    if "wood" in requested_types:
        predicates.append(and_(landuse != "forest", natural == "wood"))
    if "park" in requested_types:
        predicates.append(and_(landuse != "forest", natural != "wood"))
    return or_(*predicates)


def _map_properties(summary: PlaceSummary) -> PlaceMapFeatureProperties:
    return PlaceMapFeatureProperties(
        place_id=summary.place_id,
        display_name=summary.display_name,
        place_type=summary.place_type,
        geometry_status="available",
        source=summary.source,
        geometry_version=summary.geometry_version,
    )


@router.get("/map", response_model=PlaceMapResponse)
def place_map(
    min_lon: float = Query(...),
    min_lat: float = Query(...),
    max_lon: float = Query(...),
    max_lat: float = Query(...),
    place_type: list[PlaceType] | None = Query(default=None),
    session: Session = Depends(get_session),
) -> PlaceMapResponse:
    """Return at most 2,000 representative points intersecting one viewport."""
    _validate_viewport(min_lon, min_lat, max_lon, max_lat)
    requested_types = set(place_type or ("park", "forest", "wood", "trail"))
    envelope = func.ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
    geography_envelope = cast(envelope, Geography("POLYGON", srid=4326))
    candidates: list[PlaceMapFeature] = []

    if requested_types.intersection({"park", "forest", "wood"}):
        area_geometry = cast(MonitoredArea.geometry, Geometry("MULTIPOLYGON", srid=4326))
        area_rows = session.execute(
            select(
                MonitoredArea.id,
                MonitoredArea.name,
                MonitoredArea.metadata_json,
                func.ST_AsGeoJSON(
                    func.ST_PointOnSurface(func.ST_Intersection(area_geometry, envelope))
                ),
            )
            .where(
                func.ST_Intersects(MonitoredArea.geometry, geography_envelope),
                _available_geometry(MonitoredArea),
                _area_type_filter(requested_types),
            )
            .order_by(MonitoredArea.name, MonitoredArea.id)
            .limit(PLACE_MAP_MAX_RESULTS + 1)
        ).all()
        for place_id, name, metadata, point_json in area_rows:
            resolved_type = _classify_area(name, metadata or {})
            if resolved_type not in requested_types or not point_json:
                continue
            summary = _summary(place_id, name, metadata or {}, resolved_type)
            if summary is None:
                continue
            candidates.append(
                PlaceMapFeature(
                    id=place_id,
                    geometry=json.loads(point_json),
                    properties=_map_properties(summary),
                )
            )

    if "trail" in requested_types:
        trail_geometry = cast(Trail.geometry, Geometry("MULTILINESTRING", srid=4326))
        trail_rows = session.execute(
            select(
                Trail.id,
                Trail.name,
                Trail.metadata_json,
                func.ST_AsGeoJSON(
                    func.ST_PointOnSurface(func.ST_Intersection(trail_geometry, envelope))
                ),
            )
            .where(
                func.ST_Intersects(Trail.geometry, geography_envelope),
                _available_geometry(Trail),
            )
            .order_by(Trail.name, Trail.id)
            .limit(PLACE_MAP_MAX_RESULTS + 1)
        ).all()
        for place_id, name, metadata, point_json in trail_rows:
            if not point_json:
                continue
            summary = _summary(place_id, name, metadata or {}, "trail")
            if summary is None:
                continue
            candidates.append(
                PlaceMapFeature(
                    id=place_id,
                    geometry=json.loads(point_json),
                    properties=_map_properties(summary),
                )
            )

    candidates.sort(
        key=lambda feature: (
            feature.properties.display_name.casefold(),
            feature.properties.place_type,
            str(feature.id),
        )
    )
    truncated = len(candidates) > PLACE_MAP_MAX_RESULTS
    return PlaceMapResponse(
        features=candidates[:PLACE_MAP_MAX_RESULTS],
        truncated=truncated,
    )


@router.get("/at-location", response_model=PlaceAtLocationResponse)
def place_at_location(
    lat: float = Query(..., ge=0.8, le=7.5),
    lon: float = Query(..., ge=99.3, le=119.5),
    session: Session = Depends(get_session),
) -> PlaceAtLocationResponse:
    """Resolve the exact supported place offered after a successful report."""
    point = func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)
    area = session.scalar(
        select(MonitoredArea)
        .where(
            func.ST_Covers(
                cast(MonitoredArea.geometry, Geometry("MULTIPOLYGON", srid=4326)),
                point,
            )
        )
        .order_by(MonitoredArea.name)
        .limit(1)
    )
    if area is not None:
        return PlaceAtLocationResponse(
            place=_place_detail_response(session, area, _classify_area(area.name, _metadata(area)))
        )
    trail = session.scalar(
        select(Trail)
        .where(
            func.ST_DWithin(
                Trail.geometry,
                cast(point, Geography("POINT", srid=4326)),
                750,
            )
        )
        .order_by(func.ST_Distance(Trail.geometry, cast(point, Geography("POINT", srid=4326))))
        .limit(1)
    )
    if trail is None:
        return PlaceAtLocationResponse(place=None)
    return PlaceAtLocationResponse(place=_place_detail_response(session, trail, "trail"))


@router.get("/{place_id}", response_model=PlaceDetail)
def place_detail(place_id: uuid.UUID, session: Session = Depends(get_session)) -> PlaceDetail:
    place, place_type = _place(session, place_id)
    return _place_detail_response(session, place, place_type)


@router.get("/{place_id}/plant-associations", response_model=PlacePlantAssociationsResponse)
def plant_associations(
    place_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> PlacePlantAssociationsResponse:
    place, place_type = _place(session, place_id)
    _, _, geometry_version = _place_metadata(place)
    radius_m = 750 if place_type == "trail" else 1000
    stored_geometry = _stored_geometry(place.id, place_type)
    distance = func.ST_Distance(stored_geometry, OccurrenceRecord.location)
    spatial_match = func.ST_DWithin(
        stored_geometry,
        OccurrenceRecord.location,
        radius_m + SPATIAL_BOUNDARY_EPSILON_M,
    )
    waterway_join = and_(
        PlaceOccurrenceWaterwayEvidence.occurrence_id == OccurrenceRecord.id,
        PlaceOccurrenceWaterwayEvidence.place_id == place.id,
        PlaceOccurrenceWaterwayEvidence.place_type == place_type,
        PlaceOccurrenceWaterwayEvidence.direction_source == OSM_DIRECTION_SOURCE,
        PlaceOccurrenceWaterwayEvidence.upstream_distance_m <= 5000,
        PlaceOccurrenceWaterwayEvidence.occurrence_snap_distance_m <= MAX_SNAP_DISTANCE_M,
        PlaceOccurrenceWaterwayEvidence.place_snap_distance_m <= MAX_SNAP_DISTANCE_M,
        PlaceOccurrenceWaterwayEvidence.data_version.in_(
            select(WaterwayDataset.version).where(WaterwayDataset.active.is_(True))
        ),
    )
    upstream_match = PlaceOccurrenceWaterwayEvidence.id.is_not(None)
    columns = [
        OccurrenceRecord,
        Species,
        distance,
        PlaceOccurrenceWaterwayEvidence.id,
        PlaceOccurrenceWaterwayEvidence.data_version,
    ]
    if place_type == "trail":
        statement = (
            select(*columns)
            .join(Species, Species.id == OccurrenceRecord.species_id)
            .outerjoin(PlaceOccurrenceWaterwayEvidence, waterway_join)
            .where(or_(spatial_match, upstream_match))
        )
    else:
        inside = func.ST_Covers(
            cast(stored_geometry, Geometry("MULTIPOLYGON", srid=4326)),
            cast(OccurrenceRecord.location, Geometry("POINT", srid=4326)),
        )
        statement = (
            select(*columns, inside)
            .join(Species, Species.id == OccurrenceRecord.species_id)
            .outerjoin(PlaceOccurrenceWaterwayEvidence, waterway_join)
            .where(or_(spatial_match, upstream_match))
        )
    rows = session.execute(
        statement.order_by(distance.asc()).limit(ASSOCIATION_MAX_ROWS + 1)
    ).all()
    truncated = len(rows) > ASSOCIATION_MAX_ROWS
    rows = rows[:ASSOCIATION_MAX_ROWS]
    grouped: dict[str, list[tuple]] = defaultdict(list)
    for row in rows:
        approved = approved_species_record(row[0].species_id)
        if approved is None:
            continue
        distance_m = float(row[2])
        spatial_evidence = distance_m <= radius_m
        has_trusted_upstream = approved.water_dispersed and row[3] is not None
        if spatial_evidence or has_trusted_upstream:
            grouped[row[0].species_id].append(row)

    items: list[PlacePlantAssociation] = []
    data_versions: set[str] = set()
    waterway_data_versions: set[str] = set()
    update_times: list[datetime] = []
    for species_id, species_rows in grouped.items():
        approved = approved_species_record(species_id)
        if approved is None:
            continue
        evidence_types: set[EvidenceType] = set()
        inside_count = nearby_count = trail_count = upstream_count = 0
        distances: list[float] = []
        years: list[int] = []
        occurrence_rows: dict[uuid.UUID, list[tuple]] = defaultdict(list)
        for row in species_rows:
            occurrence_rows[row[0].id].append(row)
        for matching_rows in occurrence_rows.values():
            row = matching_rows[0]
            occurrence: OccurrenceRecord = row[0]
            distance_m = float(row[2])
            distances.append(distance_m)
            if occurrence.observed_year is not None:
                years.append(occurrence.observed_year)
            data_versions.add(occurrence.processed_data_version)
            update_times.append(occurrence.imported_at)
            if place_type == "trail":
                if distance_m <= radius_m:
                    evidence_types.add("trail_buffer")
                    trail_count += 1
            elif bool(row[5]):
                evidence_types.add("inside_boundary")
                inside_count += 1
            elif distance_m <= radius_m:
                evidence_types.add("nearby_buffer")
                nearby_count += 1
            upstream_rows = [
                candidate
                for candidate in matching_rows
                if approved.water_dispersed and candidate[3] is not None
            ]
            if upstream_rows:
                evidence_types.add("upstream")
                upstream_count += 1
                waterway_data_versions.update(
                    str(candidate[4]) for candidate in upstream_rows if candidate[4]
                )
        nearest = min(distances)
        # Return every scoring component so the client can explain and
        # reproduce the order. A direct polygon hit always outranks a
        # nearby-only hit, even at the maximum record-count contribution.
        (
            inside_component,
            proximity_component,
            record_count_component,
            upstream_component,
            rank_score,
        ) = _rank_components(
            inside_count=inside_count,
            nearby_count=nearby_count,
            trail_count=trail_count,
            upstream_count=upstream_count,
            nearest_distance_m=nearest,
            radius_m=radius_m,
            record_count=len(occurrence_rows),
        )
        items.append(
            PlacePlantAssociation(
                species_id=approved.species_id,
                scientific_name=approved.scientific_name,
                common_names=list(approved.common_names),
                malaysia_status="Present",
                image_url=_reference_image_url(approved.species_id),
                occurrence_count=len(occurrence_rows),
                most_recent_year=max(years) if years else None,
                evidence=AssociationEvidence(
                    types=sorted(evidence_types),
                    inside_count=inside_count,
                    nearby_count=nearby_count,
                    trail_count=trail_count,
                    upstream_count=upstream_count,
                    nearest_distance_m=round(nearest, 1),
                    inside_component=inside_component,
                    proximity_component=round(proximity_component, 3),
                    record_count_component=round(record_count_component, 3),
                    upstream_component=upstream_component,
                    rank_score=round(rank_score, 3),
                ),
                catalogue_url=f"/catalogue/{approved.species_id}",
            )
        )
    items.sort(key=lambda item: (-item.evidence.rank_score, item.scientific_name))
    # Iteration-2 §4: community-report contributions live in a separate,
    # lower-tier bucket. They can make a species visible for a place that
    # has no historical evidence yet, but they never masquerade as
    # historical or expert-validated evidence.
    from app.domain.place_sighting_evidence import community_report_summaries_for_place

    community_items: list[CommunityReportEvidence] = []
    for summary in community_report_summaries_for_place(
        session, place_id=place.id, place_type=place_type
    ):
        approved = approved_species_record(summary["speciesId"])
        if approved is None:
            continue
        community_items.append(
            CommunityReportEvidence(
                species_id=approved.species_id,
                scientific_name=approved.scientific_name,
                common_names=list(approved.common_names),
                active_reports=summary["activeReports"],
                removal_reports=summary["removalReports"],
                relations=summary["relations"],
                nearest_distance_m=(
                    round(summary["nearestDistanceM"], 1)
                    if summary["nearestDistanceM"] is not None
                    else None
                ),
                catalogue_url=f"/catalogue/{approved.species_id}",
            )
        )
    community_items.sort(
        key=lambda item: (-item.active_reports, item.scientific_name)
    )
    return PlacePlantAssociationsResponse(
        place_id=place.id,
        place_name=place.name,
        place_type=place_type,
        geometry_version=geometry_version,
        processed_data_versions=sorted(data_versions),
        waterway_data_versions=sorted(waterway_data_versions),
        occurrence_updated_at=max(update_times) if update_times else None,
        disclaimer=(
            "Associations are based on historical occurrence records and mapped buffers. "
            "They are not probabilities and do not show current presence or absence. "
            "Community reports appear in a separately labelled tier and are not "
            "expert-validated."
        ),
        truncated=truncated,
        items=items,
        community_reports=community_items,
    )
