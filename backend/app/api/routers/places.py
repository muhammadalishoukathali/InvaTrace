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
)
from app.domain.catalogue import (
    approved_catalogue_image,
    approved_species_record,
    load_guidance_dataset,
)
from app.waterway_import import OSM_DIRECTION_SOURCE

router = APIRouter(prefix="/api/v1/places", tags=["places"])

PlaceType = Literal["park", "forest", "wood", "trail"]
EvidenceType = Literal["inside_boundary", "nearby_buffer", "trail_buffer", "upstream"]


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
    items: list[PlaceDetail]


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


class PlacePlantAssociationsResponse(ApiModel):
    place_id: uuid.UUID
    place_name: str
    place_type: PlaceType
    geometry_version: str
    processed_data_versions: list[str]
    waterway_data_versions: list[str]
    occurrence_updated_at: datetime | None
    disclaimer: str
    items: list[PlacePlantAssociation]


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
    for item in load_guidance_dataset().get("plants", []):
        if item.get("plant_id", "").replace("_", "-") != species_id:
            continue
        image_url = item.get("reference_image")
        if isinstance(image_url, str) and approved_catalogue_image(image_url) is not None:
            return image_url
    return None


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
    geojson_raw = session.scalar(
        select(func.ST_AsGeoJSON(cast(place.geometry, Geometry(srid=4326))))
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
        view_plants_url=f"/places/{place.id}/plant-associations",
    )


@router.get("", response_model=PlaceListResponse)
def list_places(session: Session = Depends(get_session)) -> PlaceListResponse:
    items: list[PlaceDetail] = []
    for place in session.scalars(select(MonitoredArea).order_by(MonitoredArea.name)).all():
        try:
            detail = _place_detail_response(
                session, place, _classify_area(place.name, _metadata(place))
            )
        except ApiProblem:
            continue
        items.append(detail)
    for place in session.scalars(select(Trail).order_by(Trail.name)).all():
        try:
            detail = _place_detail_response(session, place, "trail")
        except ApiProblem:
            continue
        items.append(detail)
    items.sort(key=lambda item: item.display_name.casefold())
    return PlaceListResponse(items=items)


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
    distance = func.ST_Distance(place.geometry, OccurrenceRecord.location)
    spatial_match = func.ST_DWithin(place.geometry, OccurrenceRecord.location, radius_m)
    waterway_join = and_(
        PlaceOccurrenceWaterwayEvidence.occurrence_id == OccurrenceRecord.id,
        PlaceOccurrenceWaterwayEvidence.place_id == place.id,
        PlaceOccurrenceWaterwayEvidence.place_type == place_type,
        PlaceOccurrenceWaterwayEvidence.direction_source == OSM_DIRECTION_SOURCE,
        PlaceOccurrenceWaterwayEvidence.upstream_distance_m <= 5000,
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
            cast(place.geometry, Geometry("MULTIPOLYGON", srid=4326)),
            cast(OccurrenceRecord.location, Geometry("POINT", srid=4326)),
        )
        statement = (
            select(*columns, inside)
            .join(Species, Species.id == OccurrenceRecord.species_id)
            .outerjoin(PlaceOccurrenceWaterwayEvidence, waterway_join)
            .where(or_(spatial_match, upstream_match))
        )
    rows = session.execute(statement.order_by(distance.asc()).limit(5000)).all()
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
            "They are not probabilities and do not show current presence or absence."
        ),
        items=items,
    )
