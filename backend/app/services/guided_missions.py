"""Shared guided-mission rules used by the mission API and report/scan paths."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiProblem
from app.db.models import GuidedMission


def validate_mission_link(
    session: Session, mission_id: uuid.UUID, profile_id: uuid.UUID
) -> GuidedMission:
    """Fail closed before attaching a report or scan to a guided mission.

    Only an *active* mission owned by the caller may be linked. Missing,
    foreign and completed missions share one error so a caller cannot probe
    whether another profile's mission id exists.
    """
    mission = session.scalar(select(GuidedMission).where(GuidedMission.id == mission_id))
    if mission is None or mission.profile_id != profile_id or mission.status != "active":
        raise ApiProblem(422, "mission_invalid", "This guided mission cannot accept new records.")
    return mission
