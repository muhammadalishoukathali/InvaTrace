"""Non-exclusive monitoring bookmarks and factual community activity summaries."""

from __future__ import annotations

import json
import math
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from app.api.routers.places import PlaceType, _place, _place_metadata
from app.api.schemas import ApiModel
from app.core.errors import ApiProblem
from app.core.idempotency import acquire_idempotency_lock
from app.core.privacy import public_coordinates
from app.core.security import AuthContext, require_auth, utcnow
from app.db.base import get_session
from app.db.models import AdoptedArea, Sighting, SightingStatusEvent, Species
from app.domain.catalogue import approved_species_record

router = APIRouter(prefix="/api/v1/adopted-areas", tags=["adopted-areas"])

BOOKMARK_DISCLAIMER = (
    "This is a non-exclusive monitoring bookmark. It does not create ownership, "
    "management responsibility, access rights, or permission to remove plants."
)


class AdoptAreaRequest(ApiModel):
    place_id: uuid.UUID


class AdoptAreaResponse(ApiModel):
    adoption_id: uuid.UUID
    place_id: uuid.UUID
    adopted_at: datetime
    disclaimer: str = BOOKMARK_DISCLAIMER


class AdoptionMetrics(ApiModel):
    active_reports: int
    distinct_approved_species: int
    new_reports_last_30_days: int
    removal_reports_last_30_days: int
    days_since_most_recent_report: int | None


class AdoptedAreaCard(ApiModel):
    adoption_id: uuid.UUID
    place_id: uuid.UUID
    name: str
    type: PlaceType
    adopted_at: datetime
    most_recent_report_at: datetime | None
    geometry_version: str
    metrics_label: Literal["Community monitoring activity"] = "Community monitoring activity"
    metrics: AdoptionMetrics


class AdoptedAreaListResponse(ApiModel):
    items: list[AdoptedAreaCard]
    disclaimer: str = BOOKMARK_DISCLAIMER


class ActivityMarker(ApiModel):
    sighting_id: uuid.UUID
    species_id: str
    scientific_name: str
    community_label: Literal["Community report - not expert validated"] = (
        "Community report - not expert validated"
    )
    observation_date: datetime
    status: Literal["screened", "removal_reported"]
    status_date: datetime
    latitude: float
    longitude: float
    precision_reduced: bool


class ActivityComparison(ApiModel):
    recent_0_to_29_days: int
    prior_30_to_59_days: int
    direction: Literal["increased", "decreased", "unchanged"]


class RecentReportingConcentration(ApiModel):
    concentration_id: str
    report_count: int
    latitude: float
    longitude: float


class AdoptedAreaActivityResponse(ApiModel):
    adoption_id: uuid.UUID
    place_id: uuid.UUID
    name: str
    type: PlaceType
    geometry: dict
    geometry_version: str
    markers: list[ActivityMarker]
    filtered_count: int
    concentration_count: int
    concentrations: list[RecentReportingConcentration]
    comparison: ActivityComparison
    empty_message: str | None
    disclaimer: str = BOOKMARK_DISCLAIMER


def _adoption(session: Session, adoption_id: uuid.UUID, profile_id: uuid.UUID) -> AdoptedArea:
    row = session.scalar(
        select(AdoptedArea).where(
            AdoptedArea.id == adoption_id,
            AdoptedArea.profile_id == profile_id,
        )
    )
    if row is None:
        raise ApiProblem(404, "adoption_not_found", "Not found")
    return row


def _member_rows(session: Session, adoption: AdoptedArea) -> list[tuple]:
    distance_limit = 750
    if adoption.place_type == "trail":
        condition = func.ST_DWithin(adoption.geometry, Sighting.location, distance_limit)
    else:
        condition = func.ST_Covers(
            cast(adoption.geometry, Geometry("MULTIPOLYGON", srid=4326)),
            cast(Sighting.location, Geometry("POINT", srid=4326)),
        )
    return session.execute(
        select(Sighting, Species, func.max(SightingStatusEvent.created_at))
        .join(Species, Species.id == Sighting.species_id)
        .outerjoin(SightingStatusEvent, SightingStatusEvent.sighting_id == Sighting.id)
        .where(condition, Sighting.status.in_({"screened", "removal_reported"}))
        .group_by(Sighting.id, Species.id)
        .order_by(Sighting.created_at.desc(), Sighting.id.desc())
    ).all()


def _metrics(rows: list[tuple], now: datetime) -> tuple[AdoptionMetrics, datetime | None]:
    approved_rows = [row for row in rows if approved_species_record(row[0].species_id)]
    active = [row for row in approved_rows if row[0].status == "screened"]
    last_30 = now - timedelta(days=30)
    most_recent = max((row[0].created_at for row in approved_rows), default=None)
    return (
        AdoptionMetrics(
            active_reports=len(active),
            distinct_approved_species=len({row[0].species_id for row in active}),
            new_reports_last_30_days=sum(
                last_30 < row[0].created_at <= now for row in approved_rows
            ),
            removal_reports_last_30_days=sum(
                row[0].status == "removal_reported"
                and row[2] is not None
                and last_30 < row[2] <= now
                for row in approved_rows
            ),
            days_since_most_recent_report=(
                max(0, (now - most_recent).days) if most_recent is not None else None
            ),
        ),
        most_recent,
    )


@router.post("", response_model=AdoptAreaResponse, status_code=201)
def adopt_area(
    body: AdoptAreaRequest,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> AdoptAreaResponse:
    place, place_type = _place(session, body.place_id)
    _, _, geometry_version = _place_metadata(place)
    acquire_idempotency_lock(
        session,
        profile_id=auth.profile.id,
        scope="adopted-area.create",
        idempotency_key=str(place.id),
    )
    existing = session.scalar(
        select(AdoptedArea).where(
            AdoptedArea.profile_id == auth.profile.id,
            AdoptedArea.place_id == place.id,
        )
    )
    if existing is not None:
        return AdoptAreaResponse(
            adoption_id=existing.id,
            place_id=existing.place_id,
            adopted_at=existing.adopted_at,
        )
    adoption = AdoptedArea(
        profile_id=auth.profile.id,
        place_type=place_type,
        place_id=place.id,
        geometry_version=geometry_version,
        geometry=place.geometry,
    )
    session.add(adoption)
    session.commit()
    session.refresh(adoption)
    return AdoptAreaResponse(
        adoption_id=adoption.id,
        place_id=adoption.place_id,
        adopted_at=adoption.adopted_at,
    )


@router.get("", response_model=AdoptedAreaListResponse)
def list_adopted_areas(
    sort_by: Literal["recent_activity", "recent", "name"] = Query(
        default="recent_activity", alias="sort"
    ),
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> AdoptedAreaListResponse:
    now = utcnow()
    cards: list[AdoptedAreaCard] = []
    adoptions = session.scalars(
        select(AdoptedArea).where(AdoptedArea.profile_id == auth.profile.id)
    ).all()
    for adoption in adoptions:
        place, place_type = _place(session, adoption.place_id)
        metrics, most_recent = _metrics(_member_rows(session, adoption), now)
        cards.append(
            AdoptedAreaCard(
                adoption_id=adoption.id,
                place_id=adoption.place_id,
                name=place.name,
                type=place_type,
                adopted_at=adoption.adopted_at,
                most_recent_report_at=most_recent,
                geometry_version=adoption.geometry_version,
                metrics=metrics,
            )
        )
    if sort_by == "name":
        cards.sort(key=lambda card: card.name.casefold())
    else:
        cards.sort(
            key=lambda card: (
                card.most_recent_report_at is not None,
                card.most_recent_report_at or datetime.min.replace(tzinfo=UTC),
            ),
            reverse=True,
        )
    return AdoptedAreaListResponse(items=cards)


@router.delete("/{adoption_id}", status_code=204, response_model=None)
def remove_adoption(
    adoption_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> Response:
    adoption = _adoption(session, adoption_id, auth.profile.id)
    session.delete(adoption)
    session.commit()
    return Response(status_code=204)


def _haversine(left: ActivityMarker, right: ActivityMarker) -> float:
    radius = 6_371_008.8
    lat1, lat2 = math.radians(left.latitude), math.radians(right.latitude)
    dlat = lat2 - lat1
    dlon = math.radians(right.longitude - left.longitude)
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _concentrations(
    markers: list[ActivityMarker], now: datetime
) -> list[RecentReportingConcentration]:
    recent = [
        marker
        for marker in markers
        if marker.status == "screened" and now - timedelta(days=30) < marker.observation_date <= now
    ]
    groups: list[list[ActivityMarker]] = []
    remaining = sorted(recent, key=lambda marker: (marker.observation_date, marker.sighting_id))
    while remaining:
        first = remaining.pop(0)
        group = [first]
        for candidate in list(remaining):
            # AC 6.3.5 says the reports must be within 250 m of one another.
            # Requiring every pair to satisfy the radius prevents a single-link
            # A-B-C chain from overstating a geographically dispersed group.
            if all(_haversine(member, candidate) <= 250 for member in group):
                group.append(candidate)
        if len(group) >= 3:
            groups.append(group)
            selected = {marker.sighting_id for marker in group}
            remaining = [marker for marker in remaining if marker.sighting_id not in selected]
    return [
        RecentReportingConcentration(
            concentration_id=f"recent-{index + 1}",
            report_count=len(group),
            latitude=sum(marker.latitude for marker in group) / len(group),
            longitude=sum(marker.longitude for marker in group) / len(group),
        )
        for index, group in enumerate(groups)
    ]


def _comparison_counts(markers: list[ActivityMarker], now: datetime) -> tuple[int, int]:
    """Count exact half-open server-time windows: [0,30) and [30,60) days old."""
    recent_start = now - timedelta(days=30)
    prior_start = now - timedelta(days=60)
    recent = sum(recent_start < marker.observation_date <= now for marker in markers)
    prior = sum(prior_start < marker.observation_date <= recent_start for marker in markers)
    return recent, prior


def _activity_geometry_expression(adoption: AdoptedArea):
    """Return the exact map extent used by the stored membership rule."""
    if adoption.place_type == "trail":
        return func.ST_Buffer(adoption.geometry, 750)
    return cast(adoption.geometry, Geometry(srid=4326))


@router.get("/{adoption_id}/activity", response_model=AdoptedAreaActivityResponse)
def adopted_area_activity(
    adoption_id: uuid.UUID,
    species_id: str | None = Query(default=None),
    status: Literal["screened", "removal_reported"] | None = Query(default=None),
    period: Literal["30", "60", "all"] = Query(default="all"),
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> AdoptedAreaActivityResponse:
    adoption = _adoption(session, adoption_id, auth.profile.id)
    place, place_type = _place(session, adoption.place_id)
    rows = [
        row for row in _member_rows(session, adoption) if approved_species_record(row[0].species_id)
    ]
    now = utcnow()
    area_markers: list[ActivityMarker] = []
    for sighting, species, removal_at in rows:
        lat, lon, reduced = public_coordinates(
            sighting_id=str(sighting.id),
            latitude=sighting.latitude,
            longitude=sighting.longitude,
            status=sighting.status,
            reporter_trust=sighting.reporter_trust,
        )
        area_markers.append(
            ActivityMarker(
                sighting_id=sighting.id,
                species_id=species.id,
                scientific_name=species.latin_name,
                observation_date=sighting.created_at,
                status=sighting.status,
                status_date=removal_at or sighting.updated_at,
                latitude=lat,
                longitude=lon,
                precision_reduced=reduced,
            )
        )
    markers = area_markers
    if species_id:
        markers = [marker for marker in markers if marker.species_id == species_id]
    if status:
        markers = [marker for marker in markers if marker.status == status]
    # Plant/status filters scope the displayed summary. The period selector
    # does not: the comparison must retain both fixed 0-29 and 30-59 windows,
    # otherwise selecting "Last 30 days" makes the prior count always zero.
    comparison_markers = markers
    if period != "all":
        period_start = now - timedelta(days=int(period))
        markers = [
            marker
            for marker in markers
            if period_start < marker.observation_date <= now
        ]
    recent_count, prior_count = _comparison_counts(comparison_markers, now)
    concentrations = _concentrations(markers, now)
    geojson_raw = session.scalar(select(func.ST_AsGeoJSON(_activity_geometry_expression(adoption))))
    geometry = (
        json.loads(geojson_raw) if geojson_raw else {"type": "GeometryCollection", "geometries": []}
    )
    return AdoptedAreaActivityResponse(
        adoption_id=adoption.id,
        place_id=adoption.place_id,
        name=place.name,
        type=place_type,
        geometry=geometry,
        geometry_version=adoption.geometry_version,
        markers=markers,
        filtered_count=len(markers),
        concentration_count=sum(item.report_count for item in concentrations),
        concentrations=concentrations,
        comparison=ActivityComparison(
            recent_0_to_29_days=recent_count,
            prior_30_to_59_days=prior_count,
            direction=(
                "increased"
                if recent_count > prior_count
                else "decreased"
                if recent_count < prior_count
                else "unchanged"
            ),
        ),
        empty_message=(
            "No community reports recorded for this area."
            if not area_markers
            else "No community reports match the current filters."
            if not markers
            else None
        ),
    )
