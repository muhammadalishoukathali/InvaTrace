"""Community survey event API.

All identity references remain server-side; public responses deliberately expose
only a host display name and aggregate participant counts.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field, field_validator, model_validator
from sqlalchemy import cast, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.api.schemas import ApiModel
from app.config import get_settings
from app.core.errors import ApiProblem
from app.core.rate_limit import client_address, rate_limiter
from app.core.security import AuthContext, require_auth, utcnow
from app.db.base import get_session
from app.db.models import (
    AuditEvent,
    Event,
    EventCheckin,
    EventFlag,
    EventParticipant,
    Profile,
    Report,
    Species,
)
from app.services.events import assert_event_geometry_current, event_place, point_within_event_place

router = APIRouter(prefix="/api/v1/events", tags=["events"])
places_router = APIRouter(prefix="/api/v1/places", tags=["events"])
EVENT_TYPES = {"survey", "removal", "monitoring", "other"}


class EventCreate(ApiModel):
    place_id: uuid.UUID
    event_type: Literal["survey", "removal", "monitoring", "other"]
    title: str = Field(min_length=1, max_length=120)
    purpose: str = Field(min_length=1)
    target_species_ids: list[str] = Field(default_factory=list)
    meeting_latitude: float = Field(ge=0.8, le=7.5)
    meeting_longitude: float = Field(ge=99.3, le=119.5)
    meeting_note: str | None = Field(default=None, max_length=500)
    start_at: datetime
    end_at: datetime
    safety_notes: str | None = None
    permission_context: Literal["unknown", "explicit_permission"]
    chat_link: str | None = Field(default=None, max_length=500)
    capacity: int | None = Field(default=None, ge=1)

    @field_validator("chat_link")
    @classmethod
    def secure_chat_link(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            return None
        if value is not None and (
            urlsplit(value).scheme != "https"
            or not urlsplit(value).hostname
            or urlsplit(value).username is not None
        ):
            raise ValueError("chat_link must use https")
        return value

    @model_validator(mode="after")
    def valid_times(self):
        if (
            self.start_at.tzinfo is None
            or self.end_at.tzinfo is None
            or self.end_at <= self.start_at
        ):
            raise ValueError("end_at must be after start_at and timestamps must include timezone")
        return self


class EventPatch(ApiModel):
    event_type: Literal["survey", "removal", "monitoring", "other"] | None = None
    title: str | None = Field(default=None, min_length=1, max_length=120)
    purpose: str | None = Field(default=None, min_length=1)
    target_species_ids: list[str] | None = None
    place_id: uuid.UUID | None = None
    meeting_latitude: float | None = Field(default=None, ge=0.8, le=7.5)
    meeting_longitude: float | None = Field(default=None, ge=99.3, le=119.5)
    meeting_note: str | None = Field(default=None, max_length=500)
    start_at: datetime | None = None
    end_at: datetime | None = None
    safety_notes: str | None = None
    permission_context: Literal["unknown", "explicit_permission"] | None = None
    chat_link: str | None = Field(default=None, max_length=500)
    capacity: int | None = Field(default=None, ge=1)
    status: Literal["draft", "published", "cancelled", "completed"] | None = None
    restore: bool = False

    @field_validator("chat_link")
    @classmethod
    def secure_chat_link(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            return None
        if value is not None and (
            urlsplit(value).scheme != "https"
            or not urlsplit(value).hostname
            or urlsplit(value).username is not None
        ):
            raise ValueError("chat_link must use https")
        return value

    @model_validator(mode="after")
    def valid_supplied_times(self):
        for value in (self.start_at, self.end_at):
            if value is not None and value.tzinfo is None:
                raise ValueError("timestamps must include timezone")
        if self.start_at is not None and self.end_at is not None and self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class CheckinRequest(ApiModel):
    latitude: float = Field(ge=0.8, le=7.5)
    longitude: float = Field(ge=99.3, le=119.5)
    accuracy_m: float = Field(ge=0)
    captured_at: datetime

    @field_validator("captured_at")
    @classmethod
    def fresh_location_fix(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("captured_at must include timezone")
        # A GPS fix older than five minutes is not a check-in location. Future
        # values beyond a minute also indicate a broken device clock.
        now = datetime.now(UTC)
        if value < now - timedelta(minutes=5) or value > now + timedelta(minutes=1):
            raise ApiProblem(
                422, "fresh_location_required", "Get a fresh location fix and try again."
            )
        return value


class FlagRequest(ApiModel):
    reason: str = Field(min_length=1, max_length=500)


def _assert_species(session: Session, ids: list[str]) -> None:
    if not ids:
        return
    actual = set(session.scalars(select(Species.id).where(Species.id.in_(ids))).all())
    if actual != set(ids):
        raise ApiProblem(422, "invalid_target_species", "One or more target species are invalid.")


def _activity_locked(session: Session, event: Event) -> bool:
    return bool(
        session.scalar(select(EventCheckin.id).where(EventCheckin.event_id == event.id).limit(1))
        or session.scalar(select(Report.id).where(Report.event_id == event.id).limit(1))
    )


def _host_cap(session: Session, profile_id: uuid.UUID, excluding: uuid.UUID | None = None) -> None:
    # A lock on the profile serialises competing create/publish attempts from
    # one identity, avoiding a cap race under concurrent requests.
    session.scalar(select(Profile.id).where(Profile.id == profile_id).with_for_update())
    statement = select(func.count(Event.id)).where(
        Event.host_profile_id == profile_id, Event.status.in_({"draft", "published"})
    )
    if excluding:
        statement = statement.where(Event.id != excluding)
    if (session.scalar(statement) or 0) >= get_settings().event_host_cap:
        raise ApiProblem(429, "event_host_cap_exceeded", "Maximum active hosted events reached.")


def _can_restore(session: Session, event: Event) -> bool:
    if not event.hidden:
        return False
    if event.status != "cancelled":
        return True
    last_lifecycle = session.scalar(
        select(AuditEvent.event_type)
        .where(
            AuditEvent.subject_type == "event",
            AuditEvent.subject_id == str(event.id),
            AuditEvent.event_type.in_({"event.auto_cancelled", "event.cancelled"}),
        )
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .limit(1)
    )
    return last_lifecycle == "event.auto_cancelled"


def _serialize(
    session: Session, event: Event, viewer: uuid.UUID | None = None, detail: bool = False
) -> dict:
    joined_count = (
        session.scalar(
            select(func.count(EventParticipant.id)).where(
                EventParticipant.event_id == event.id, EventParticipant.status == "joined"
            )
        )
        or 0
    )
    joined = False
    participation_id = None
    if viewer:
        participation = session.scalar(
            select(EventParticipant).where(
                EventParticipant.event_id == event.id,
                EventParticipant.profile_id == viewer,
                EventParticipant.status == "joined",
            )
        )
        joined = participation is not None
        participation_id = participation.id if participation is not None else None
    host = session.get(Profile, event.host_profile_id)
    place, _, _ = event_place(session, event.place_id)
    last_checkin_at = session.scalar(
        select(func.max(EventCheckin.checked_in_at)).where(
            EventCheckin.event_id == event.id, EventCheckin.profile_id == viewer
        )
    )
    data = {
        "event_id": event.id,
        "status": event.status,
        "event_type": event.event_type,
        "title": event.title,
        "purpose": event.purpose,
        "target_species_ids": event.target_species_ids or [],
        "place_id": event.place_id,
        "place_name": place.name,
        "meeting_latitude": float(event.meeting_latitude),
        "meeting_longitude": float(event.meeting_longitude),
        "meeting_note": event.meeting_note,
        "start_at": event.start_at,
        "end_at": event.end_at,
        "safety_notes": event.safety_notes,
        "permission_context": event.permission_context,
        "capacity": event.capacity,
        "joined_count": int(joined_count),
        "last_checkin_at": last_checkin_at,
        "community_label": "Community event - not expert validated",
        "host_display_name": (
            host.display_name if host and host.display_name else "Community host"
        ),
    }
    if detail:
        is_host = viewer == event.host_profile_id
        data.update(
            {
                "host_display_name": (
                    host.display_name
                    if host is not None and host.display_name
                    else "Community host"
                ),
                "is_joined": joined,
                "participation_id": participation_id,
                "is_host": is_host,
                "can_restore": is_host and _can_restore(session, event),
                "hidden": event.hidden if is_host else False,
                "activity_locked": _activity_locked(session, event),
                "chat_link": event.chat_link
                if (is_host or joined) and not event.hidden and event.status != "cancelled"
                else None,
            }
        )
    return data


def _event_or_404(session: Session, event_id: uuid.UUID, lock: bool = False) -> Event:
    statement = select(Event).where(Event.id == event_id)
    if lock:
        statement = statement.with_for_update()
    event = session.scalar(statement)
    if event is None:
        raise ApiProblem(404, "event_not_found", "Not found")
    return event


@router.post("", status_code=201)
def create_event(
    body: EventCreate,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
):
    rate_limiter.check("events_write", str(auth.profile.id))
    _host_cap(session, auth.profile.id)
    _assert_species(session, body.target_species_ids)
    if body.event_type == "removal" and body.permission_context != "explicit_permission":
        raise ApiProblem(
            422,
            "removal_permission_required",
            "Removal events require explicit removal permission.",
        )
    place, place_type, version = event_place(session, body.place_id)
    if not point_within_event_place(
        session, place, place_type, body.meeting_latitude, body.meeting_longitude
    ):
        raise ApiProblem(
            422, "meeting_point_outside_place", "Meeting point is outside the event place."
        )
    event = Event(
        host_profile_id=auth.profile.id,
        place_id=body.place_id,
        place_type=place_type,
        geometry_version=version,
        status="draft",
        **body.model_dump(exclude={"place_id"}),
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return {"event_id": event.id, "status": event.status}


@router.patch("/{event_id}")
def patch_event(
    event_id: uuid.UUID,
    body: EventPatch,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
):
    rate_limiter.check("events_write", str(auth.profile.id))
    event = _event_or_404(session, event_id, lock=True)
    if event.host_profile_id != auth.profile.id:
        raise ApiProblem(403, "forbidden", "Forbidden")
    changes = body.model_dump(exclude_unset=True)
    locked = {
        "place_id",
        "meeting_latitude",
        "meeting_longitude",
        "start_at",
        "end_at",
        "event_type",
    }
    if _activity_locked(session, event) and locked.intersection(changes):
        raise ApiProblem(409, "event_fields_locked", "Event fields are locked after activity.")
    if body.restore:
        # Only a moderation-hidden event has a flag tally to clear.  Letting a
        # still-visible host send {restore: true} would erase one or two
        # distinct safety flags before they reach the configured hide threshold.
        if not event.hidden:
            raise ApiProblem(409, "event_not_hidden", "This event is not hidden.")
        if event.hidden and event.status == "cancelled":
            if not _can_restore(session, event):
                raise ApiProblem(
                    409,
                    "invalid_status_transition",
                    "A manually cancelled event cannot be restored.",
                )
            # Restore an automatic cancellation through the normal publish
            # checks below, including cap and current meeting geometry.
            event.status = "draft"
            changes["status"] = "published"
        event.hidden = False
        event.hidden_at = None
        session.query(EventFlag).filter(EventFlag.event_id == event.id).delete(
            synchronize_session=False
        )
    if "target_species_ids" in changes and changes["target_species_ids"] is not None:
        _assert_species(session, changes["target_species_ids"])
    if (
        changes.get("event_type", event.event_type) == "removal"
        and changes.get("permission_context", event.permission_context) != "explicit_permission"
    ):
        raise ApiProblem(
            422,
            "removal_permission_required",
            "Removal events require explicit removal permission.",
        )
    nullable = {"meeting_note", "safety_notes", "chat_link"}
    for name, value in changes.items():
        if name not in {"restore", "status"}:
            if value is None and name not in nullable:
                continue
            setattr(event, name, value)
    if changes.get("place_id") is not None:
        place, place_type, version = event_place(session, event.place_id)
        event.place_type = place_type
        event.geometry_version = version
    else:
        place, place_type, _ = event_place(session, event.place_id)
    if any(
        k in changes for k in {"place_id", "meeting_latitude", "meeting_longitude"}
    ) and not point_within_event_place(
        session, place, place_type, event.meeting_latitude, event.meeting_longitude
    ):
        raise ApiProblem(
            422, "meeting_point_outside_place", "Meeting point is outside the event place."
        )
    if event.end_at <= event.start_at:
        raise ApiProblem(422, "invalid_event_time", "End time must be after start time.")
    if "status" in changes and changes["status"] not in {None, "published", "draft"}:
        raise ApiProblem(
            422, "invalid_status_transition", "Use cancel or the lifecycle worker for this status."
        )
    if changes.get("status") == "published":
        if event.status not in {"draft", "published"}:
            raise ApiProblem(
                409,
                "invalid_status_transition",
                "Only active draft or published events can be published.",
            )
        _host_cap(session, auth.profile.id, excluding=event.id)
        place, place_type, version = event_place(session, event.place_id)
        if not point_within_event_place(
            session, place, place_type, event.meeting_latitude, event.meeting_longitude
        ):
            raise ApiProblem(
                422, "meeting_point_outside_place", "Meeting point is outside the event place."
            )
        event.place_type = place_type
        event.geometry_version = version
        event.status = "published"
    elif changes.get("status") == "draft":
        if event.status not in {"draft", "published"} or _activity_locked(session, event):
            raise ApiProblem(
                409, "invalid_status_transition", "An event with activity cannot return to draft."
            )
        event.status = "draft"
    session.commit()
    return _serialize(session, event, auth.profile.id, True)


@router.delete("/{event_id}", status_code=204)
def cancel_event(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
):
    rate_limiter.check("events_write", str(auth.profile.id))
    event = _event_or_404(session, event_id, lock=True)
    if event.host_profile_id != auth.profile.id:
        raise ApiProblem(403, "forbidden", "Forbidden")
    # Repeated deletes are safe retries, and a completed event is terminal:
    # cancelling it would hide the factual summary that completion made
    # available.  Only active draft/published events can transition here.
    if event.status == "cancelled":
        return
    if event.status not in {"draft", "published"}:
        raise ApiProblem(
            409,
            "invalid_status_transition",
            "Only draft or published events can be cancelled.",
        )
    event.status = "cancelled"
    session.add(
        AuditEvent(
            event_type="event.cancelled",
            subject_type="event",
            subject_id=str(event.id),
            metadata_json={},
        )
    )
    session.commit()


def _upcoming_statement(now: datetime):
    return select(Event).where(
        Event.status == "published", Event.end_at > now, Event.hidden.is_(False)
    )


@router.get("")
def list_events(
    request: Request,
    bbox: str | None = None,
    from_at: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    species_id: list[str] | None = Query(default=None),
    session: Session = Depends(get_session),
):
    rate_limiter.check("events_read", client_address(request))
    if any(value is not None and value.tzinfo is None for value in (from_at, to)) or (
        from_at is not None and to is not None and to < from_at
    ):
        raise ApiProblem(
            422, "invalid_event_time", "Use timezone-aware dates with Until after From."
        )
    statement = _upcoming_statement(utcnow())
    if bbox:
        try:
            west, south, east, north = map(float, bbox.split(","))
        except ValueError as error:
            raise ApiProblem(400, "invalid_bbox", "bbox must be west,south,east,north.") from error
        if not (99.3 <= west <= east <= 119.5 and 0.8 <= south <= north <= 7.5):
            raise ApiProblem(400, "invalid_bbox", "The bounding box is invalid.")
        statement = statement.where(
            Event.meeting_longitude.between(west, east),
            Event.meeting_latitude.between(south, north),
        )
    if from_at:
        statement = statement.where(Event.end_at >= from_at)
    if to:
        statement = statement.where(Event.start_at <= to)
    if species_id:
        # FastAPI accepts repeated query parameters; accepting comma-separated
        # values too keeps ordinary browser links usable. An event may match any
        # selected target species.
        species_ids = [item for value in species_id for item in value.split(",") if item]
        species_filters = []
        for value in species_ids:
            # JSON_TYPE is generic JSON at the ORM declaration so its default
            # comparator emits a text LIKE expression.  Cast it to JSONB on
            # PostgreSQL to use the correct array-containment operator (@>).
            species_filters.append(cast(Event.target_species_ids, JSONB).contains([value]))
        if species_filters:
            statement = statement.where(or_(*species_filters))
    rows = session.scalars(statement.order_by(Event.start_at, Event.id)).all()
    return {"items": [_serialize(session, e) for e in rows]}


@places_router.get("/{place_id}/events")
def list_place_events(
    place_id: uuid.UUID,
    request: Request,
    bbox: str | None = None,
    from_at: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    species_id: list[str] | None = Query(default=None),
    session: Session = Depends(get_session),
):
    event_place(session, place_id)
    result = list_events(request, bbox, from_at, to, species_id, session)
    return {"items": [item for item in result["items"] if item["place_id"] == place_id]}


@router.get("/mine")
def my_events(auth: AuthContext = Depends(require_auth), session: Session = Depends(get_session)):
    rows = session.scalars(
        select(Event)
        .where(Event.host_profile_id == auth.profile.id)
        .order_by(Event.start_at.desc())
    ).all()
    return {"items": [_serialize(session, e, auth.profile.id, True) for e in rows]}


@router.get("/{event_id}")
def get_event(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
):
    event = _event_or_404(session, event_id)
    if (event.hidden or event.status == "draft") and event.host_profile_id != auth.profile.id:
        raise ApiProblem(404, "event_not_found", "Not found")
    return _serialize(session, event, auth.profile.id, True)


@router.post("/{event_id}/participants", status_code=201)
def join_event(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
):
    rate_limiter.check("events_write", str(auth.profile.id))
    event = _event_or_404(session, event_id, lock=True)
    if event.status != "published" or event.hidden:
        raise ApiProblem(409, "event_not_joinable", "This event is not joinable.")
    participant = session.scalar(
        select(EventParticipant)
        .where(
            EventParticipant.event_id == event.id, EventParticipant.profile_id == auth.profile.id
        )
        .with_for_update()
    )
    if participant is None:
        participant = EventParticipant(
            event_id=event.id, profile_id=auth.profile.id, status="joined"
        )
        session.add(participant)
    elif participant.status == "withdrawn":
        participant.status = "joined"
        participant.withdrawn_at = None
    session.commit()
    session.refresh(participant)
    return {"participation_id": participant.id, "status": participant.status}


@router.delete("/{event_id}/participants/{participation_id}", status_code=204)
def withdraw_event(
    event_id: uuid.UUID,
    participation_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
):
    rate_limiter.check("events_write", str(auth.profile.id))
    participant = session.scalar(
        select(EventParticipant)
        .where(EventParticipant.id == participation_id, EventParticipant.event_id == event_id)
        .with_for_update()
    )
    if participant is None:
        raise ApiProblem(404, "participation_not_found", "Not found")
    if participant.profile_id != auth.profile.id:
        raise ApiProblem(403, "forbidden", "Forbidden")
    participant.status = "withdrawn"
    participant.withdrawn_at = utcnow()
    session.commit()


@router.post("/{event_id}/check-in", status_code=201)
def check_in(
    event_id: uuid.UUID,
    body: CheckinRequest,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
):
    rate_limiter.check("check_in", str(auth.profile.id))
    event = _event_or_404(session, event_id, lock=True)
    now = utcnow()
    if event.status != "published" or event.hidden:
        raise ApiProblem(422, "event_not_published", "Event is not published.")
    if body.accuracy_m > 250:
        raise ApiProblem(422, "accuracy_too_low", "GPS accuracy must be 250m or better.")
    if (
        now < event.start_at - timedelta(minutes=get_settings().event_checkin_grace_minutes)
        or now > event.end_at
    ):
        raise ApiProblem(422, "outside_time_window", "Outside the event time window.")
    place, place_type = assert_event_geometry_current(session, event)
    if not point_within_event_place(session, place, place_type, body.latitude, body.longitude):
        raise ApiProblem(422, "outside_place", "Outside the event place.")
    participant = session.scalar(
        select(EventParticipant)
        .where(
            EventParticipant.event_id == event.id, EventParticipant.profile_id == auth.profile.id
        )
        .with_for_update()
    )
    if participant is None:
        session.add(
            EventParticipant(event_id=event.id, profile_id=auth.profile.id, status="joined")
        )
    elif participant.status == "withdrawn":
        participant.status = "joined"
        participant.withdrawn_at = None
    checkin = EventCheckin(
        event_id=event.id,
        profile_id=auth.profile.id,
        latitude=body.latitude,
        longitude=body.longitude,
        accuracy_m=body.accuracy_m,
    )
    session.add(checkin)
    session.commit()
    session.refresh(checkin)
    return {"checkin_id": checkin.id, "checked_in_at": checkin.checked_in_at}


@router.post("/{event_id}/flag", status_code=202)
def flag_event(
    event_id: uuid.UUID,
    body: FlagRequest,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
):
    rate_limiter.check("flag", str(auth.profile.id))
    event = _event_or_404(session, event_id, lock=True)
    if event.host_profile_id == auth.profile.id:
        raise ApiProblem(403, "self_flag_forbidden", "Hosts cannot flag their own event.")
    flag = session.scalar(
        select(EventFlag).where(
            EventFlag.event_id == event.id, EventFlag.reporter_profile_id == auth.profile.id
        )
    )
    if flag is None:
        session.add(
            EventFlag(event_id=event.id, reporter_profile_id=auth.profile.id, reason=body.reason)
        )
        session.flush()
    count = (
        session.scalar(select(func.count(EventFlag.id)).where(EventFlag.event_id == event.id)) or 0
    )
    if count >= get_settings().event_flag_hide_threshold and not event.hidden:
        event.hidden = True
        event.hidden_at = utcnow()
    session.commit()
    return {"flagged": True, "hidden": event.hidden}


@router.get("/{event_id}/summary")
def event_summary(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
):
    event = _event_or_404(session, event_id)
    if event.hidden and event.host_profile_id != auth.profile.id:
        raise ApiProblem(404, "event_not_found", "Not found")
    if event.status != "completed":
        raise ApiProblem(409, "event_not_completed", "Summary is available after completion.")
    place, _, _ = event_place(session, event.place_id)
    reports = session.scalars(
        select(Report).where(
            Report.event_id == event.id,
            Report.status == "screened",
            Report.captured_at.between(event.start_at, event.end_at),
        )
    ).all()
    next_event = session.scalar(
        _upcoming_statement(utcnow())
        .where(Event.place_id == event.place_id, Event.start_at > utcnow())
        .order_by(Event.start_at)
        .limit(1)
    )
    return {
        "event_id": event.id,
        "reports_submitted_count": len(reports),
        "distinct_species_count": len({r.species_id for r in reports if r.species_id}),
        "place_id": event.place_id,
        "place_name": place.name,
        "start_at": event.start_at,
        "end_at": event.end_at,
        "next_event": (
            {"event_id": next_event.id, "start_at": next_event.start_at} if next_event else None
        ),
    }
