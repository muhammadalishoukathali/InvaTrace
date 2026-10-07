"""Epic 7 - guided habitat search missions.

A mission is a private, per-profile checklist for searching one place for the
plants on the caller's watchlist. Identity always comes from the bearer token;
the API never accepts a client-supplied profile id. Reports and scans may carry
an optional ``missionId`` (validated in app/services/guided_missions.py) and are
counted in the mission summary.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import Field, field_validator
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.routers.places import _place
from app.api.schemas import ApiModel
from app.core.errors import ApiProblem
from app.core.rate_limit import rate_limiter
from app.core.security import AuthContext, require_auth, utcnow
from app.db.base import get_session
from app.db.models import (
    GuidedMission,
    GuidedMissionPlantProgress,
    Report,
    ReportSightingLink,
    Scan,
    Sighting,
    Species,
)

router = APIRouter(prefix="/api/v1/guided-missions", tags=["guided-missions"])

MAX_WATCHLIST_SPECIES = 64
PlantState = Literal["not_checked", "looked_for", "unable_to_check"]
MissionStatus = Literal["active", "completed"]
# Reports that no longer stand as community evidence are not counted toward a
# mission: screening rejections, and published reports whose sighting the
# reporter withdrew. Deleted reports are hard-deleted and drop out naturally.
EXCLUDED_REPORT_STATUSES = ("rejected",)
EXCLUDED_SIGHTING_STATUSES = ("withdrawn",)


class GuidedMissionCreate(ApiModel):
    place_id: uuid.UUID
    watchlist_species_ids: list[str] = Field(max_length=MAX_WATCHLIST_SPECIES)
    dataset_version: str = Field(min_length=1, max_length=80)

    @field_validator("watchlist_species_ids")
    @classmethod
    def bounded_species_ids(cls, value: list[str]) -> list[str]:
        for item in value:
            if not item.strip() or len(item) > 80:
                raise ValueError("species ids must be 1-80 characters")
        return value

    @field_validator("dataset_version")
    @classmethod
    def non_blank_dataset_version(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("datasetVersion must not be blank")
        return value.strip()


class GuidedMissionPatch(ApiModel):
    # Required but nullable: null clears the current selection.
    selected_species_id: str | None = Field(max_length=80)


class PlantProgressUpdate(ApiModel):
    state: PlantState
    # Omitted keeps the current no-find flag while the plant stays looked_for.
    no_target_found: bool | None = None


class MissionPlant(ApiModel):
    species_id: str
    state: PlantState
    no_target_found: bool
    updated_at: datetime


class MissionReport(ApiModel):
    report_id: uuid.UUID
    species_id: str | None
    status: str
    submitted_at: datetime


class GuidedMissionResponse(ApiModel):
    mission_id: uuid.UUID
    place_id: uuid.UUID
    status: MissionStatus
    dataset_version: str
    selected_species_id: str | None
    started_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    plants: list[MissionPlant]
    scans_count: int
    reports: list[MissionReport]


class GuidedMissionSummary(ApiModel):
    mission_id: uuid.UUID
    place_id: uuid.UUID
    status: MissionStatus
    started_at: datetime
    completed_at: datetime | None
    looked_for_count: int
    unable_to_check_count: int
    not_checked_count: int
    no_target_found_count: int
    scans_count: int
    reports_submitted_count: int
    reports: list[MissionReport]


def _assert_place(session: Session, place_id: uuid.UUID) -> None:
    try:
        _place(session, place_id)
    except ApiProblem as error:
        if error.status_code == 404:
            raise ApiProblem(422, "place_not_found", "The place does not exist.") from error
        raise


def _assert_species(session: Session, species_ids: list[str]) -> None:
    known = set(session.scalars(select(Species.id).where(Species.id.in_(species_ids))).all())
    if known != set(species_ids):
        raise ApiProblem(422, "unknown_species", "One or more watchlist species are unknown.")


def _mission_for(
    session: Session, mission_id: uuid.UUID, profile_id: uuid.UUID, *, lock: bool = False
) -> GuidedMission:
    statement = select(GuidedMission).where(GuidedMission.id == mission_id)
    if lock:
        statement = statement.with_for_update()
    mission = session.scalar(statement)
    if mission is None:
        raise ApiProblem(404, "mission_not_found", "Not found")
    if mission.profile_id != profile_id:
        raise ApiProblem(403, "not_mission_owner", "This mission belongs to another profile.")
    return mission


def _active_mission(
    session: Session, profile_id: uuid.UUID, place_id: uuid.UUID
) -> GuidedMission | None:
    return session.scalar(
        select(GuidedMission).where(
            GuidedMission.profile_id == profile_id,
            GuidedMission.place_id == place_id,
            GuidedMission.status == "active",
        )
    )


def _assert_active(mission: GuidedMission) -> None:
    if mission.status != "active":
        raise ApiProblem(409, "mission_completed", "This mission has already been completed.")


def _plants(session: Session, mission_id: uuid.UUID) -> list[GuidedMissionPlantProgress]:
    return list(
        session.scalars(
            select(GuidedMissionPlantProgress)
            .where(GuidedMissionPlantProgress.mission_id == mission_id)
            .order_by(GuidedMissionPlantProgress.position, GuidedMissionPlantProgress.species_id)
        ).all()
    )


def _reports(session: Session, mission_id: uuid.UUID) -> list[MissionReport]:
    withdrawn = exists(
        select(ReportSightingLink.report_id)
        .join(Sighting, Sighting.id == ReportSightingLink.sighting_id)
        .where(
            ReportSightingLink.report_id == Report.id,
            ReportSightingLink.active.is_(True),
            Sighting.status.in_(EXCLUDED_SIGHTING_STATUSES),
        )
    )
    rows = session.execute(
        select(Report.id, Report.species_id, Report.status, Report.created_at)
        .where(
            Report.mission_id == mission_id,
            Report.status.not_in(EXCLUDED_REPORT_STATUSES),
            ~withdrawn,
        )
        .order_by(Report.created_at, Report.id)
    ).all()
    return [
        MissionReport(report_id=row[0], species_id=row[1], status=row[2], submitted_at=row[3])
        for row in rows
    ]


def _scans_count(session: Session, mission_id: uuid.UUID) -> int:
    return int(
        session.scalar(select(func.count(Scan.id)).where(Scan.mission_id == mission_id)) or 0
    )


def _serialize(session: Session, mission: GuidedMission) -> GuidedMissionResponse:
    return GuidedMissionResponse(
        mission_id=mission.id,
        place_id=mission.place_id,
        status=mission.status,
        dataset_version=mission.dataset_version,
        selected_species_id=mission.selected_species_id,
        started_at=mission.started_at,
        updated_at=mission.updated_at,
        completed_at=mission.completed_at,
        plants=[
            MissionPlant(
                species_id=plant.species_id,
                state=plant.state,
                no_target_found=plant.no_target_found,
                updated_at=plant.updated_at,
            )
            for plant in _plants(session, mission.id)
        ],
        scans_count=_scans_count(session, mission.id),
        reports=_reports(session, mission.id),
    )


def _summary(session: Session, mission: GuidedMission) -> GuidedMissionSummary:
    plants = _plants(session, mission.id)
    reports = _reports(session, mission.id)
    return GuidedMissionSummary(
        mission_id=mission.id,
        place_id=mission.place_id,
        status=mission.status,
        started_at=mission.started_at,
        completed_at=mission.completed_at,
        looked_for_count=sum(plant.state == "looked_for" for plant in plants),
        unable_to_check_count=sum(plant.state == "unable_to_check" for plant in plants),
        not_checked_count=sum(plant.state == "not_checked" for plant in plants),
        no_target_found_count=sum(
            plant.state == "looked_for" and plant.no_target_found for plant in plants
        ),
        scans_count=_scans_count(session, mission.id),
        reports_submitted_count=len(reports),
        reports=reports,
    )


@router.post("", response_model=GuidedMissionResponse, status_code=201)
def create_guided_mission(
    body: GuidedMissionCreate,
    response: Response,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> GuidedMissionResponse:
    rate_limiter.check("guided_mission_write", str(auth.profile.id))
    # Order-preserving de-duplication keeps the client's checklist order.
    species_ids = list(dict.fromkeys(item.strip() for item in body.watchlist_species_ids))
    if not species_ids:
        raise ApiProblem(422, "empty_watchlist", "Add at least one plant to the watchlist.")
    _assert_place(session, body.place_id)
    _assert_species(session, species_ids)
    existing = _active_mission(session, auth.profile.id, body.place_id)
    if existing is not None:
        response.status_code = 200
        return _serialize(session, existing)
    now = utcnow()
    mission = GuidedMission(
        profile_id=auth.profile.id,
        place_id=body.place_id,
        status="active",
        dataset_version=body.dataset_version,
        started_at=now,
        updated_at=now,
    )
    session.add(mission)
    try:
        session.flush()
    except IntegrityError:
        # A concurrent request created the active mission first; the partial
        # unique index guarantees there is exactly one to resume.
        session.rollback()
        existing = _active_mission(session, auth.profile.id, body.place_id)
        if existing is None:
            raise
        response.status_code = 200
        return _serialize(session, existing)
    session.add_all(
        GuidedMissionPlantProgress(
            mission_id=mission.id,
            species_id=species_id,
            position=index,
            state="not_checked",
            no_target_found=False,
            updated_at=now,
        )
        for index, species_id in enumerate(species_ids)
    )
    session.commit()
    return _serialize(session, mission)


@router.get("/active", response_model=GuidedMissionResponse)
def active_guided_mission(
    place_id: uuid.UUID | None = Query(default=None),
    place_id_camel: uuid.UUID | None = Query(default=None, alias="placeId"),
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> GuidedMissionResponse:
    rate_limiter.check("guided_mission_read", str(auth.profile.id))
    resolved = place_id or place_id_camel
    if resolved is None:
        raise ApiProblem(422, "place_id_required", "place_id is required.")
    mission = _active_mission(session, auth.profile.id, resolved)
    if mission is None:
        raise ApiProblem(404, "mission_not_found", "No active mission for this place.")
    return _serialize(session, mission)


@router.get("/{mission_id}", response_model=GuidedMissionResponse)
def get_guided_mission(
    mission_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> GuidedMissionResponse:
    rate_limiter.check("guided_mission_read", str(auth.profile.id))
    return _serialize(session, _mission_for(session, mission_id, auth.profile.id))


@router.patch("/{mission_id}", response_model=GuidedMissionResponse)
def patch_guided_mission(
    mission_id: uuid.UUID,
    body: GuidedMissionPatch,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> GuidedMissionResponse:
    rate_limiter.check("guided_mission_write", str(auth.profile.id))
    mission = _mission_for(session, mission_id, auth.profile.id, lock=True)
    _assert_active(mission)
    selected = body.selected_species_id
    if selected is not None and selected not in {
        plant.species_id for plant in _plants(session, mission.id)
    }:
        raise ApiProblem(
            422, "species_not_in_mission", "The selected plant is not part of this mission."
        )
    mission.selected_species_id = selected
    mission.updated_at = utcnow()
    session.commit()
    return _serialize(session, mission)


@router.put("/{mission_id}/plants/{species_id}", response_model=GuidedMissionResponse)
def put_plant_progress(
    mission_id: uuid.UUID,
    species_id: str,
    body: PlantProgressUpdate,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> GuidedMissionResponse:
    rate_limiter.check("guided_mission_write", str(auth.profile.id))
    mission = _mission_for(session, mission_id, auth.profile.id, lock=True)
    _assert_active(mission)
    plant = session.scalar(
        select(GuidedMissionPlantProgress)
        .where(
            GuidedMissionPlantProgress.mission_id == mission.id,
            GuidedMissionPlantProgress.species_id == species_id,
        )
        .with_for_update()
    )
    if plant is None:
        raise ApiProblem(404, "species_not_in_mission", "This plant is not part of this mission.")
    if body.no_target_found and body.state != "looked_for":
        raise ApiProblem(
            422,
            "no_find_requires_looked_for",
            "No target found can only be recorded after looking for the plant.",
        )
    if body.state != "looked_for":
        no_target_found = False
    elif body.no_target_found is None:
        no_target_found = plant.no_target_found if plant.state == "looked_for" else False
    else:
        no_target_found = body.no_target_found
    now = utcnow()
    plant.state = body.state
    plant.no_target_found = no_target_found
    plant.updated_at = now
    mission.updated_at = now
    session.commit()
    return _serialize(session, mission)


@router.post("/{mission_id}/complete", response_model=GuidedMissionSummary)
def complete_guided_mission(
    mission_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> GuidedMissionSummary:
    rate_limiter.check("guided_mission_write", str(auth.profile.id))
    mission = _mission_for(session, mission_id, auth.profile.id, lock=True)
    # Completing twice is a safe retry and returns the same summary.
    if mission.status != "completed":
        now = utcnow()
        mission.status = "completed"
        mission.completed_at = now
        mission.updated_at = now
        session.commit()
    return _summary(session, mission)


@router.get("/{mission_id}/summary", response_model=GuidedMissionSummary)
def guided_mission_summary(
    mission_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> GuidedMissionSummary:
    rate_limiter.check("guided_mission_read", str(auth.profile.id))
    return _summary(session, _mission_for(session, mission_id, auth.profile.id))
