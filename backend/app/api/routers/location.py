"""AC 4.3.1 / 4.3.2 - nearest OpenStreetMap-derived feature within 5km, with fallback.

Given a lat/lng, finds the nearest named trail/park/forest/wood from the
OSM-derived tables so the report/sighting UI can show something like "near
Bukit Kiara Trail" instead of raw coordinates. Used by the report submission
flow when the app wants to label where a sighting happened.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from geoalchemy2 import Geography, Geometry
from pydantic import Field
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from app.api.schemas import ApiModel
from app.db.base import get_session
from app.db.models import (
    MonitoredArea,
    MonitoredPlace,
    ProtectedArea,
    ProtectedAreaDataset,
    Trail,
)

router = APIRouter(prefix="/api/v1/location-context", tags=["location"])

FeatureType = Literal["trail", "park", "forest", "wood", "seed", "none"]


class LocationContextResponse(ApiModel):
    found: bool
    feature_type: FeatureType | None = None
    feature_name: str | None = None
    distance_m: float | None = None
    context_status: Literal["available", "temporarily_unavailable"] = "available"


ContextState = Literal[
    "inside_protected_area",
    "no_protected_area_intersection",
    "boundary_uncertain",
]


class ProtectedLocationContextRequest(ApiModel):
    latitude: float = Field(ge=0.8, le=7.5)
    longitude: float = Field(ge=99.3, le=119.5)
    accuracy_m: float = Field(ge=0)


class ProtectedLocationContextResponse(ApiModel):
    context_state: ContextState
    inside_protected_area: bool | None
    boundary_source: str | None
    boundary_version: str | None
    boundary_updated_at: str | None
    protected_area_name: str | None
    accuracy_m: float
    action_eligible: bool
    permission_confirmation_required: bool
    disclaimer: str


PERMISSION_DISCLAIMER = (
    "Being outside a mapped protected area does not establish ownership, access rights, or permission. "
    "Confirm permission from the land or waterbody manager before any active step."
)


def _uncertain_context(
    body: ProtectedLocationContextRequest,
    dataset: ProtectedAreaDataset | None = None,
) -> ProtectedLocationContextResponse:
    return ProtectedLocationContextResponse(
        context_state="boundary_uncertain",
        inside_protected_area=None,
        boundary_source=dataset.source if dataset else None,
        boundary_version=dataset.version if dataset else None,
        boundary_updated_at=dataset.updated_at.isoformat() if dataset else None,
        protected_area_name=None,
        accuracy_m=body.accuracy_m,
        action_eligible=False,
        permission_confirmation_required=True,
        disclaimer=(
            "Protected-area status is unavailable or uncertain. Observe and report only; "
            "do not touch, collect, cut or remove the plant."
        ),
    )


@router.post("", response_model=ProtectedLocationContextResponse)
def protected_location_context(
    body: ProtectedLocationContextRequest,
    session: Session = Depends(get_session),
) -> ProtectedLocationContextResponse:
    """Fail closed when the boundary release or GPS fix is not reliable."""
    dataset = session.scalar(
        select(ProtectedAreaDataset)
        .where(ProtectedAreaDataset.active.is_(True))
        .order_by(ProtectedAreaDataset.updated_at.desc())
        .limit(1)
    )
    if body.accuracy_m > 250 or dataset is None:
        return _uncertain_context(body, dataset)
    try:
        point = func.ST_SetSRID(func.ST_MakePoint(body.longitude, body.latitude), 4326)
        covered = session.scalar(
            select(
                func.ST_Covers(
                    cast(dataset.coverage_geometry, Geometry("MULTIPOLYGON", srid=4326)),
                    point,
                )
            )
        )
        if not covered:
            return _uncertain_context(body, dataset)
        area = session.scalar(
            select(ProtectedArea)
            .where(
                ProtectedArea.dataset_id == dataset.id,
                func.ST_Covers(
                    cast(ProtectedArea.geometry, Geometry("MULTIPOLYGON", srid=4326)),
                    point,
                ),
            )
            .limit(1)
        )
    except Exception:
        return _uncertain_context(body, dataset)

    if area is not None:
        return ProtectedLocationContextResponse(
            context_state="inside_protected_area",
            inside_protected_area=True,
            boundary_source=dataset.source,
            boundary_version=dataset.version,
            boundary_updated_at=dataset.updated_at.isoformat(),
            protected_area_name=area.name or None,
            accuracy_m=body.accuracy_m,
            action_eligible=False,
            permission_confirmation_required=True,
            disclaimer=(
                "This location intersects a mapped protected area. Observe and report only; "
                "do not touch, collect, cut or remove the plant."
            ),
        )
    return ProtectedLocationContextResponse(
        context_state="no_protected_area_intersection",
        inside_protected_area=False,
        boundary_source=dataset.source,
        boundary_version=dataset.version,
        boundary_updated_at=dataset.updated_at.isoformat(),
        protected_area_name=None,
        accuracy_m=body.accuracy_m,
        action_eligible=True,
        permission_confirmation_required=True,
        disclaimer=PERMISSION_DISCLAIMER,
    )


# OSM doesn't have a clean single tag for "what kind of green space is this,"
# so we sniff the raw tags we stored to bucket it into one of our three types.
def _classify_area(name: str, metadata: dict) -> Literal["park", "forest", "wood"]:
    tags = (metadata or {}).get("tags") or {}
    if tags.get("landuse") == "forest" or metadata.get("landuse") == "forest":
        return "forest"
    if tags.get("natural") == "wood" or metadata.get("natural") == "wood":
        return "wood"
    return "park"


# lat/lon bounds are roughly Malaysia's bounding box - anything outside that
# gets rejected by FastAPI's own validation before we even touch the DB.
@router.get("", response_model=LocationContextResponse)
def location_context(
    lat: float = Query(..., ge=0.8, le=7.5),
    lon: float = Query(..., ge=99.3, le=119.5),
    radius_m: int = Query(default=5000, ge=100, le=10000),
    session: Session = Depends(get_session),
) -> LocationContextResponse:
    try:
        point = func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)
        geography = cast(point, Geography("POINT", srid=4326))

        # AC 4.3.1: prefer named trails (highway=path/footway/track), parks, forests, woods.
        trail = session.execute(
            select(Trail, func.ST_Distance(Trail.geometry, geography))
            .where(func.ST_DWithin(Trail.geometry, geography, radius_m))
            .order_by(func.ST_Distance(Trail.geometry, geography))
            .limit(1)
        ).first()

        area = session.execute(
            select(MonitoredArea, func.ST_Distance(MonitoredArea.geometry, geography))
            .where(func.ST_DWithin(MonitoredArea.geometry, geography, radius_m))
            .order_by(func.ST_Distance(MonitoredArea.geometry, geography))
            .limit(1)
        ).first()

        candidates: list[tuple[FeatureType, str, float]] = []
        if trail is not None:
            candidates.append(("trail", trail[0].name, float(trail[1])))
        if area is not None:
            candidates.append(
                (
                    _classify_area(area[0].name, area[0].metadata_json or {}),
                    area[0].name,
                    float(area[1]),
                )
            )

        if candidates:
            candidates.sort(key=lambda item: item[2])
            feature_type, feature_name, distance = candidates[0]
            return LocationContextResponse(
                found=True,
                feature_type=feature_type,
                feature_name=feature_name,
                distance_m=round(distance, 1),
            )

        # Seed-place fallback (still real data, not fabricated)
        seeded = session.execute(
            select(MonitoredPlace, func.ST_Distance(MonitoredPlace.location, geography))
            .where(func.ST_DWithin(MonitoredPlace.location, geography, radius_m))
            .order_by(func.ST_Distance(MonitoredPlace.location, geography))
            .limit(1)
        ).first()
        if seeded is not None:
            return LocationContextResponse(
                found=True,
                feature_type="seed",
                feature_name=seeded[0].name,
                distance_m=round(float(seeded[1]), 1),
            )

        # AC 4.3.2: no result - surface `found=false`; caller must not fabricate a name.
        return LocationContextResponse(found=False)
    except Exception:
        # AC 4.3.2: OSM/PostGIS failure must not block report publication.
        return LocationContextResponse(
            found=False,
            context_status="temporarily_unavailable",
        )
