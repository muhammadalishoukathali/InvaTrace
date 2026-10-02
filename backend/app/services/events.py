"""Shared Event rules used by the Event API and report submission path."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from app.api.routers.places import _place, _place_metadata
from app.config import get_settings
from app.core.errors import ApiProblem
from app.db.models import Event, EventCheckin, Report


def event_place(session: Session, place_id: uuid.UUID):
    """Resolve a supported event place and its stable geometry snapshot version."""
    place, place_type = _place(session, place_id)
    _, _, geometry_version = _place_metadata(place)
    return place, place_type, geometry_version


def point_within_event_place(
    session: Session, place, place_type: str, latitude: float, longitude: float
) -> bool:
    """Use the same membership contract everywhere: polygon covers, trail 750m."""
    point = cast(
        func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326),
        Geography("POINT", srid=4326),
    )
    if place_type == "trail":
        condition = func.ST_DWithin(place.geometry, point, 750.001)
    else:
        condition = func.ST_Covers(
            cast(place.geometry, Geometry("MULTIPOLYGON", srid=4326)),
            cast(point, Geometry("POINT", srid=4326)),
        )
    # Query the expression instead of materialising geometry into Python.
    return bool(session.scalar(select(condition)))


def assert_event_geometry_current(session: Session, event: Event):
    place, place_type, version = event_place(session, event.place_id)
    if event.geometry_version != version:
        raise ApiProblem(422, "event_geometry_stale", "The event place geometry has changed.")
    return place, place_type


def validate_event_report(
    session: Session,
    event_id: uuid.UUID,
    profile_id: uuid.UUID,
    latitude: float,
    longitude: float,
    captured_at: datetime | None,
    now: datetime | None = None,
) -> Event:
    """Fail closed before creating an event-tagged report.

    The caller remains responsible for requiring ``captured_at`` at its API
    boundary. This hook deliberately owns all state, check-in, geometry, time,
    and per-identity budget checks so report and event paths cannot drift.
    """
    now = now or datetime.now(UTC)
    event = session.scalar(select(Event).where(Event.id == event_id).with_for_update())
    if event is None or event.status not in {"published", "completed"} or event.hidden:
        raise ApiProblem(422, "event_not_taggable", "This event cannot accept reports.")
    if captured_at is None:
        raise ApiProblem(
            422, "captured_at_required", "Capture time is required for an event report."
        )
    if captured_at.tzinfo is None:
        captured_at = captured_at.replace(tzinfo=UTC)
    if not event.start_at <= captured_at <= event.end_at:
        raise ApiProblem(
            422, "captured_at_outside_event", "Capture time is outside the event window."
        )
    if now > event.end_at + timedelta(hours=24):
        raise ApiProblem(422, "upload_grace_exceeded", "The event upload grace period has ended.")
    checkin = session.scalar(
        select(EventCheckin.id)
        .where(EventCheckin.event_id == event.id, EventCheckin.profile_id == profile_id)
        .order_by(EventCheckin.checked_in_at.desc())
        .limit(1)
    )
    if checkin is None:
        raise ApiProblem(422, "checkin_required", "Check in before adding an event report.")
    place, place_type = assert_event_geometry_current(session, event)
    if not point_within_event_place(session, place, place_type, latitude, longitude):
        raise ApiProblem(422, "outside_place", "The report location is outside the event place.")
    used = (
        session.scalar(
            select(func.count(Report.id)).where(
                Report.event_id == event.id, Report.profile_id == profile_id
            )
        )
        or 0
    )
    if used >= get_settings().event_report_budget_per_identity:
        raise ApiProblem(429, "event_budget_exceeded", "Event report budget reached.")
    return event
