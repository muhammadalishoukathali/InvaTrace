"""Public map data: the sighting list behind the map and one sighting's detail.

A sighting is the deduplicated, public version of one or more reports - reports
are private to their author, sightings are what everyone sees. The list route
carries the map filters (species, status, risk, bounding box, search) and is
cursor-paginated, and it is the single busiest endpoint in the app because the
map refetches on every filter change.

Coordinates served from here are the blurred ones. The exact location a reporter
submitted stays in the reports table and is never serialized by this module -
see app/core/privacy.py for where the blurring happens.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from geoalchemy2 import Geography
from pydantic import Field
from sqlalchemy import cast, func, or_, select
from sqlalchemy.orm import Session

from app.api.schemas import (
    ApiModel,
    GeoPoint,
    PlaceAssociation,
    SightingDetailResponse,
    SightingListResponse,
    SightingResponse,
)
from app.core.errors import ApiProblem, request_id_var
from app.core.pagination import decode_cursor, encode_cursor
from app.core.privacy import public_coordinates
from app.core.rate_limit import client_address, rate_limiter
from app.core.security import AuthContext, require_auth, utcnow
from app.db.base import get_session
from app.db.models import (
    AuditEvent,
    MonitoredArea,
    Report,
    ReportSightingLink,
    Sighting,
    SightingStatusEvent,
    Species,
    Trail,
)
from app.domain.action_guidance import action_summary, current_action_guide
from app.domain.reporting import coordinate
from app.services.storage import storage

"""Public sighting feed and map - the read side of screened reports.

This is what the map/feed view calls. Only ever returns sightings in
status screened or removal_reported (never processing/rejected/needs_rescan - those
stay private on the reporter's own "my reports" list). Coordinates get
run through app/core/privacy.py before going out, since untrusted reporters'
exact locations shouldn't be publicly pinpointable.
"""

router = APIRouter(prefix="/api/v1/sightings", tags=["sightings"])

FOLLOW_UP_MAX_M = 250


class FollowUpRequest(ApiModel):
    """A fresh browser GPS fix and the observer's follow-up outcome.

    Exact coordinates only ever reach the append-only status-event table;
    public sighting serializers below deliberately omit them.
    """

    latitude: float = Field(ge=0.8, le=7.5)
    longitude: float = Field(ge=99.3, le=119.5)
    accuracy_m: float = Field(ge=0)
    captured_at: datetime
    outcome: Literal["no_regrowth", "regrowth_present", "unable_to_confirm"]


class FollowUpResponse(ApiModel):
    sighting_id: uuid.UUID
    outcome: Literal["no_regrowth", "regrowth_present", "unable_to_confirm"]
    follow_up_state: Literal["needed", "resolved", "regrowth"]
    last_followup_at: datetime


def _validate_follow_up_location(
    *,
    captured_at: datetime,
    accuracy_m: float,
    distance_m: float | None,
    now: datetime,
) -> float:
    """Apply the stricter 250 m follow-up gate without weakening removal's 350 m rule."""
    if captured_at.tzinfo is None:
        captured_at = captured_at.replace(tzinfo=UTC)
    if captured_at < now - timedelta(minutes=5) or captured_at > now + timedelta(minutes=1):
        raise ApiProblem(
            422,
            "follow_up_location_stale",
            "Use a fresh browser location before recording a follow-up.",
        )
    if accuracy_m > FOLLOW_UP_MAX_M:
        raise ApiProblem(
            422, "follow_up_accuracy_too_low", "Location accuracy must be 250 metres or better."
        )
    if distance_m is None:
        raise ApiProblem(
            503, "follow_up_location_unavailable", "Location validation is unavailable."
        )
    if distance_m > FOLLOW_UP_MAX_M:
        raise ApiProblem(
            422, "follow_up_too_far", "You must be within 250 metres of the reported plant."
        )
    return distance_m


# Turns a raw Sighting + joined Species/place data into the public API shape.
# Shared by both list_sightings and sighting_detail so the privacy logic and
# place-source labeling only live in one place.
def serialize_sighting(
    sighting: Sighting,
    species: Species,
    report_count: int,
    last_reported_at: datetime | None,
    area_name: str | None,
    trail_name: str | None,
    confidence: float | None = None,
    removal_reported_at: datetime | None = None,
) -> SightingResponse:
    lat, lng, reduced = public_coordinates(
        sighting_id=str(sighting.id),
        latitude=sighting.latitude,
        longitude=sighting.longitude,
        status=sighting.status,
        reporter_trust=sighting.reporter_trust,
    )
    # Tells the frontend how confident to be about the place label - a real
    # OSM match, one of our seeded reference places, or the generic
    # "somewhere in Malaysia" fallback when we couldn't resolve anything.
    place_source = (
        "osm"
        if area_name or trail_name
        else ("fallback" if sighting.place_label == "Reported location, Malaysia" else "seed")
    )
    return SightingResponse(
        id=str(sighting.id),
        species_id=species.id,
        species_name=species.name,
        latin_name=species.latin_name,
        status=sighting.status,
        risk=sighting.risk,
        location=GeoPoint(lat=lat, lng=lng),
        precision_reduced=reduced,
        report_count=report_count,
        last_reported_at=last_reported_at or sighting.created_at,
        removal_reported_at=removal_reported_at,
        # Legacy removal rows predate the derived column. They are still
        # follow-up candidates until an outcome is recorded.
        follow_up_state=(
            getattr(sighting, "follow_up_state", None)
            or ("needed" if sighting.status == "removal_reported" else None)
        ),
        last_followup_at=getattr(sighting, "last_followup_at", None),
        place=PlaceAssociation(
            display_name=sighting.place_label,
            area_name=area_name,
            trail_name=trail_name,
            source=place_source,
        ),
        thumbnail_url=storage.presign_get(sighting.thumbnail_key)
        if sighting.thumbnail_key
        else None,
        confidence=confidence,
        nearest_feature_type=sighting.nearest_feature_type,
        nearest_feature_name=sighting.nearest_feature_name,
        nearest_feature_distance_m=(
            float(sighting.nearest_feature_distance_m)
            if sighting.nearest_feature_distance_m is not None
            else None
        ),
    )


# Main feed/map query - backs both the list view and the map's marker
# clustering. Supports filtering by species/status/risk/text search plus
# either a lat/lng box or the bbox alias the map view sends when panning.
@router.get("", response_model=SightingListResponse)
def list_sightings(
    request: Request,
    species: Annotated[list[str] | None, Query()] = None,
    status: Annotated[list[str] | None, Query()] = None,
    risk: Annotated[list[str] | None, Query()] = None,
    q: str | None = Query(default=None, max_length=120),
    min_lat: float | None = Query(default=None, ge=0.8, le=7.5),
    max_lat: float | None = Query(default=None, ge=0.8, le=7.5),
    min_lng: float | None = Query(default=None, ge=99.3, le=119.5),
    max_lng: float | None = Query(default=None, ge=99.3, le=119.5),
    bbox: str | None = Query(
        default=None,
        description="AC 4.2.1 alias: comma-separated `west,south,east,north` in EPSG:4326",
    ),
    follow_up: Literal["needed", "resolved", "regrowth", "any"] = Query(default="any"),
    limit: int = Query(default=200, ge=1, le=500),
    cursor: str | None = None,
    session: Session = Depends(get_session),
) -> SightingListResponse:
    # bbox is just a friendlier alias for min/max lat/lng that the map
    # component sends as one query param instead of four - unpack it into
    # the same variables so the rest of the function doesn't care which
    # style the caller used.
    if bbox is not None:
        parts = bbox.split(",")
        if len(parts) != 4:
            raise ApiProblem(400, "invalid_bbox", "bbox must be west,south,east,north.")
        try:
            west, south, east, north = (float(part) for part in parts)
        except ValueError as error:
            raise ApiProblem(400, "invalid_bbox", "bbox values must be numeric.") from error
        for value, lo, hi in (
            (south, 0.8, 7.5),
            (north, 0.8, 7.5),
            (west, 99.3, 119.5),
            (east, 99.3, 119.5),
        ):
            if not lo <= value <= hi:
                raise ApiProblem(400, "invalid_bbox", "bbox is outside the supported region.")
        min_lat, max_lat, min_lng, max_lng = south, north, west, east
    rate_limiter.check("sightings_read", client_address(request))
    offset = decode_cursor(cursor)
    # ReportSightingLink.active filters out reports that got merged into this
    # sighting and then later unlinked (e.g. an admin fixed a bad merge) - we
    # only want currently-active links counted toward report_count.
    # A sighting can now have many append-only status events. Count reports
    # distinctly so joining that history never inflates the public evidence
    # count, and only label the original removal event as removal-reported.
    count_expr = func.count(func.distinct(Report.id)).filter(ReportSightingLink.active.is_(True))
    latest_expr = func.max(Report.observed_at).filter(ReportSightingLink.active.is_(True))
    # AC 4.2.2 - representative confidence per aggregated sighting = the
    # highest confidence across currently-linked reports. Defined consistently
    # for both list and detail endpoints.
    confidence_expr = func.max(Report.confidence).filter(ReportSightingLink.active.is_(True))
    statement = (
        select(
            Sighting,
            Species,
            count_expr,
            latest_expr,
            MonitoredArea.name,
            Trail.name,
            confidence_expr,
            func.max(SightingStatusEvent.created_at).filter(
                SightingStatusEvent.event_type == "removal_reported"
            ),
        )
        .join(Species, Species.id == Sighting.species_id)
        .outerjoin(MonitoredArea, MonitoredArea.id == Sighting.area_id)
        .outerjoin(Trail, Trail.id == Sighting.trail_id)
        .outerjoin(ReportSightingLink, ReportSightingLink.sighting_id == Sighting.id)
        .outerjoin(Report, Report.id == ReportSightingLink.report_id)
        .outerjoin(SightingStatusEvent, SightingStatusEvent.sighting_id == Sighting.id)
        .where(Sighting.status.in_({"screened", "removal_reported", "resolved_after_follow_up"}))
        .group_by(Sighting.id, Species.id, MonitoredArea.name, Trail.name)
        .order_by(Sighting.updated_at.desc(), Sighting.id.desc())
    )
    if species:
        statement = statement.where(Sighting.species_id.in_(species))
    if status:
        allowed = {"screened", "removal_reported", "resolved_after_follow_up"}
        if not set(status).issubset(allowed):
            raise ApiProblem(400, "invalid_filter", "The status filter is invalid.")
        statement = statement.where(Sighting.status.in_(status))
    if follow_up == "needed":
        statement = statement.where(
            or_(Sighting.follow_up_state == "needed", Sighting.status == "removal_reported")
        )
    elif follow_up == "resolved":
        statement = statement.where(
            or_(
                Sighting.follow_up_state == "resolved",
                Sighting.status == "resolved_after_follow_up",
            )
        )
    elif follow_up == "regrowth":
        statement = statement.where(Sighting.follow_up_state == "regrowth")
    elif follow_up == "any":
        # Resolved markers are intentionally absent from the ordinary map.
        statement = statement.where(Sighting.status != "resolved_after_follow_up")
    if risk:
        if not set(risk).issubset({"high", "watch"}):
            raise ApiProblem(400, "invalid_filter", "The risk filter is invalid.")
        statement = statement.where(Sighting.risk.in_(risk))
    if q:
        pattern = f"%{q.strip()}%"
        statement = statement.where(
            or_(Species.name.ilike(pattern), Species.latin_name.ilike(pattern))
        )
    if None not in {min_lat, max_lat, min_lng, max_lng}:
        if min_lat > max_lat or min_lng > max_lng:
            raise ApiProblem(400, "invalid_bbox", "The bounding box is invalid.")
        statement = statement.where(
            Sighting.latitude.between(min_lat, max_lat),
            Sighting.longitude.between(min_lng, max_lng),
        )
    rows = session.execute(statement.offset(offset).limit(limit)).all()
    return SightingListResponse(
        items=[
            serialize_sighting(
                row[0],
                row[1],
                int(row[2]),
                row[3],
                row[4],
                row[5],
                confidence=float(row[6]) if row[6] is not None else None,
                removal_reported_at=row[7],
            )
            for row in rows
        ],
        next_cursor=encode_cursor(offset, len(rows), limit),
    )


# Single-sighting detail page - same privacy rules as the list endpoint, plus
# the removal action guidance the map marker's detail panel shows.
@router.get("/{sighting_id}", response_model=SightingDetailResponse)
def sighting_detail(
    sighting_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> SightingDetailResponse:
    rate_limiter.check("sightings_read", client_address(request))
    try:
        import uuid

        parsed_id = uuid.UUID(sighting_id)
    except ValueError as error:
        # A malformed id isn't a real 400 - we don't want to leak "this
        # exists but the id was wrong" vs "doesn't exist" so it's just 404.
        raise ApiProblem(404, "sighting_not_found", "Not found") from error
    row = session.execute(
        select(
            Sighting,
            Species,
            func.count(func.distinct(Report.id)).filter(ReportSightingLink.active.is_(True)),
            func.max(Report.observed_at).filter(ReportSightingLink.active.is_(True)),
            MonitoredArea.name,
            Trail.name,
            func.max(Report.confidence).filter(ReportSightingLink.active.is_(True)),
            func.max(SightingStatusEvent.created_at).filter(
                SightingStatusEvent.event_type == "removal_reported"
            ),
        )
        .join(Species, Species.id == Sighting.species_id)
        .outerjoin(MonitoredArea, MonitoredArea.id == Sighting.area_id)
        .outerjoin(Trail, Trail.id == Sighting.trail_id)
        .outerjoin(ReportSightingLink, ReportSightingLink.sighting_id == Sighting.id)
        .outerjoin(Report, Report.id == ReportSightingLink.report_id)
        .outerjoin(SightingStatusEvent, SightingStatusEvent.sighting_id == Sighting.id)
        .where(
            Sighting.id == parsed_id,
            Sighting.status.in_({"screened", "removal_reported", "resolved_after_follow_up"}),
        )
        .group_by(Sighting.id, Species.id, MonitoredArea.name, Trail.name)
    ).first()
    if not row:
        raise ApiProblem(404, "sighting_not_found", "Not found")
    summary = serialize_sighting(
        row[0],
        row[1],
        int(row[2]),
        row[3],
        row[4],
        row[5],
        confidence=float(row[6]) if row[6] is not None else None,
        removal_reported_at=row[7],
    )
    removal_report_id = session.scalar(
        select(ReportSightingLink.report_id)
        .where(
            ReportSightingLink.sighting_id == parsed_id,
            ReportSightingLink.active.is_(True),
        )
        .order_by(ReportSightingLink.linked_at, ReportSightingLink.report_id)
        .limit(1)
    )
    follow_up_history = session.execute(
        select(SightingStatusEvent.event_type, SightingStatusEvent.created_at)
        .where(
            SightingStatusEvent.sighting_id == parsed_id,
            SightingStatusEvent.event_type.in_(
                {"removal_reported", "followup_no_regrowth", "followup_regrowth", "followup_unable"}
            ),
        )
        .order_by(SightingStatusEvent.created_at.asc(), SightingStatusEvent.id.asc())
    ).all()
    return SightingDetailResponse(
        **summary.model_dump(),
        recommended_action=action_summary(row[1]),
        action_guide=current_action_guide(row[1]),
        reporter_trust=row[0].reporter_trust,
        removal_report_id=str(removal_report_id) if removal_report_id else None,
        follow_up_history=[
            {"event_type": event_type, "created_at": created_at}
            for event_type, created_at in follow_up_history
        ],
    )


@router.post("/{sighting_id}/follow-up", response_model=FollowUpResponse, status_code=201)
def record_follow_up(
    sighting_id: uuid.UUID,
    body: FollowUpRequest,
    request: Request,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> FollowUpResponse:
    """Record one nearby monitoring attempt against a removal-reported sighting."""
    now = utcnow()
    sighting = session.scalar(select(Sighting).where(Sighting.id == sighting_id).with_for_update())
    if sighting is None:
        raise ApiProblem(404, "sighting_not_found", "Not found")

    follow_up_state = getattr(sighting, "follow_up_state", None)
    if sighting.status != "removal_reported" and follow_up_state != "needed":
        raise ApiProblem(
            409,
            "follow_up_not_available",
            "A follow-up can only be recorded for a removal-reported sighting.",
        )

    submitted_point = cast(
        func.ST_SetSRID(func.ST_MakePoint(body.longitude, body.latitude), 4326),
        Geography("POINT", srid=4326),
    )
    distance_m = session.scalar(
        select(func.ST_Distance(Sighting.location, submitted_point)).where(
            Sighting.id == sighting.id
        )
    )
    distance_m = _validate_follow_up_location(
        captured_at=body.captured_at,
        accuracy_m=body.accuracy_m,
        distance_m=float(distance_m) if distance_m is not None else None,
        now=now,
    )
    event_type_by_outcome = {
        "no_regrowth": "followup_no_regrowth",
        "regrowth_present": "followup_regrowth",
        "unable_to_confirm": "followup_unable",
    }
    state_by_outcome = {
        "no_regrowth": ("resolved_after_follow_up", "resolved"),
        "regrowth_present": ("screened", "regrowth"),
        "unable_to_confirm": (sighting.status, "needed"),
    }
    next_status, next_state = state_by_outcome[body.outcome]
    event = SightingStatusEvent(
        sighting_id=sighting.id,
        # Follow-ups are independent observations. Newer schema revisions
        # intentionally keep this nullable, unlike the original removal row.
        report_id=None,
        acting_profile_id=auth.profile.id,
        event_type=event_type_by_outcome[body.outcome],
        latitude=coordinate(body.latitude),
        longitude=coordinate(body.longitude),
        accuracy_m=body.accuracy_m,
        distance_m=round(distance_m, 2),
    )
    sighting.status = next_status
    sighting.follow_up_state = next_state
    sighting.last_followup_at = now
    session.add(event)
    session.add(
        AuditEvent(
            event_type=f"sighting.follow_up_{body.outcome}",
            acting_profile_id=auth.profile.id,
            subject_type="sighting",
            subject_id=str(sighting.id),
            request_id=request_id_var.get(),
            metadata_json={
                "accuracy_m": body.accuracy_m,
                "distance_m": round(distance_m, 2),
            },
        )
    )
    session.commit()
    session.refresh(sighting)
    return FollowUpResponse(
        sighting_id=sighting.id,
        outcome=body.outcome,
        follow_up_state=next_state,
        last_followup_at=sighting.last_followup_at,
    )
