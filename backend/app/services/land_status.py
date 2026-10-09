"""Land status of an event place, derived from the mapped protected-area data.

Epic 9 hosts no longer self-declare land-manager permission. Instead the
server checks the chosen place against the active protected-area release and
decides which event types may be hosted there. Removal is only offered where
the place is confidently outside mapped protected land; anything the data
cannot place with confidence fails closed to ``uncertain``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import structlog
from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from app.db.models import MonitoredArea, ProtectedArea, ProtectedAreaDataset, Trail

log = structlog.get_logger("invatrace.land_status")

LandStatusValue = Literal["protected", "not_protected", "uncertain"]

# Same 750 m buffer that defines trail membership for check-in and meeting points.
TRAIL_BUFFER_M = 750.0
PROTECTED_OSM_TAGS = {
    ("boundary", "protected_area"),
    ("boundary", "national_park"),
    ("leisure", "nature_reserve"),
}
OBSERVE_ONLY_TYPES = ["survey", "monitoring", "other"]
ALLOWED_EVENT_TYPES: dict[str, list[str]] = {
    "protected": OBSERVE_ONLY_TYPES,
    "uncertain": OBSERVE_ONLY_TYPES,
    "not_protected": ["survey", "removal", "monitoring", "other"],
}
LAND_STATUS_DISCLAIMER = (
    "Mapped status is not removal permission. Being outside a mapped protected area does not "
    "establish ownership, access rights, or permission; every participant still goes through "
    "the safety checks before any active step."
)


@dataclass(frozen=True)
class LandStatus:
    status: LandStatusValue
    protected_area_name: str | None = None
    operator: str | None = None
    dataset_version: str | None = None

    @property
    def allowed_event_types(self) -> list[str]:
        return ALLOWED_EVENT_TYPES[self.status]

    @property
    def reason(self) -> str:
        if self.status == "protected":
            name = self.protected_area_name or "a mapped protected area"
            return (
                f"This place overlaps {name}. Only survey, monitoring or other observe-and-report "
                "activities can be hosted here."
            )
        if self.status == "uncertain":
            return (
                "Protected-area status could not be confirmed for this place, so only survey, "
                "monitoring or other observe-and-report activities can be hosted here."
            )
        return "This place is not in a mapped protected area. All activity types are available."


def _operator(metadata: dict | None) -> str | None:
    metadata = metadata or {}
    tags = metadata.get("tags") or {}
    value = tags.get("operator") or metadata.get("operator")
    return str(value) if value else None


def _tagged_protected(place) -> bool:
    tags = (place.metadata_json or {}).get("tags") or {}
    return any(tags.get(key) == value for key, value in PROTECTED_OSM_TAGS)


def place_land_status(session: Session, place, place_type: str) -> LandStatus:
    """Classify a MonitoredArea or Trail; never raises, fails closed to uncertain."""
    if place_type != "trail" and _tagged_protected(place):
        # The place itself was imported from a protected-area OSM boundary.
        return LandStatus("protected", protected_area_name=place.name)
    dataset = session.scalar(
        select(ProtectedAreaDataset)
        .where(ProtectedAreaDataset.active.is_(True))
        .order_by(ProtectedAreaDataset.updated_at.desc())
        .limit(1)
    )
    if dataset is None:
        return LandStatus("uncertain")
    model = Trail if place_type == "trail" else MonitoredArea
    place_geometry = select(model.geometry).where(model.id == place.id).scalar_subquery()
    try:
        # A savepoint keeps a failed spatial query from aborting the caller's
        # transaction (an event write may already be pending in the session).
        with session.begin_nested():
            return _lookup(session, dataset, place_geometry, place_type)
    except Exception:
        log.warning("land_status_lookup_failed", place_id=str(place.id), exc_info=True)
        return LandStatus("uncertain", dataset_version=dataset.version)


def _lookup(session: Session, dataset, place_geometry, place_type: str) -> LandStatus:
    covered = session.scalar(
        select(
            func.ST_Covers(
                cast(dataset.coverage_geometry, Geometry("MULTIPOLYGON", srid=4326)),
                cast(place_geometry, Geometry(srid=4326)),
            )
        )
    )
    if not covered:
        return LandStatus("uncertain", dataset_version=dataset.version)
    if place_type == "trail":
        overlaps = func.ST_DWithin(ProtectedArea.geometry, place_geometry, TRAIL_BUFFER_M)
    else:
        overlaps = func.ST_Intersects(ProtectedArea.geometry, place_geometry)
    area = session.execute(
        select(ProtectedArea.name, ProtectedArea.metadata_json)
        .where(ProtectedArea.dataset_id == dataset.id, overlaps)
        .limit(1)
    ).first()
    if area is not None:
        return LandStatus(
            "protected",
            protected_area_name=area.name or None,
            operator=_operator(area.metadata_json),
            dataset_version=dataset.version,
        )
    return LandStatus("not_protected", dataset_version=dataset.version)
