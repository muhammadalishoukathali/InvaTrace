"""Iteration-2 §4 - compute community-report contributions to a place.

The reviewed historical GBIF table is authoritative for the
``historicalRecords`` count. Community sightings are surfaced in a
separate, lower-tier ``communityReports`` bucket. Never merge one into
the other or describe a community report as expert-validated.

The refresh entry point is deliberately targeted: given one sighting id
it inserts (or leaves in place) the rows for that sighting only, so a
verification-worker retry never rebuilds the whole graph.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Iterable

from geoalchemy2 import Geography
from sqlalchemy import cast, delete, func, select
from sqlalchemy.orm import Session

from app.api.routers.location import _classify_area
from app.db.models import (
    MonitoredArea,
    PlaceSightingEvidence,
    Sighting,
    Trail,
)

# AC 5.1.3 - area associations accept "inside" (ST_Covers) plus a 1,000 m
# nearby buffer. Trails use a 750 m buffer. The values match the historical
# occurrence pipeline so the two evidence tiers are directly comparable.
AREA_NEARBY_BUFFER_M = 1000.0
TRAIL_BUFFER_M = 750.0

# The community-report pipeline is versioned so a future rule change (a
# change to the buffers, or an added upstream-waterway branch) invalidates
# the cache automatically without touching historical rows.
COMMUNITY_CALCULATION_VERSION = "invatrace.place-sighting-evidence.v1"


def _sighting_geography(sighting: Sighting):
    point = func.ST_SetSRID(
        func.ST_MakePoint(sighting.longitude, sighting.latitude), 4326
    )
    return cast(point, Geography("POINT", srid=4326))


def _existing_relations(
    session: Session, sighting_id: uuid.UUID
) -> set[tuple[uuid.UUID, str, str]]:
    rows = session.execute(
        select(
            PlaceSightingEvidence.place_id,
            PlaceSightingEvidence.relation_type,
            PlaceSightingEvidence.calculation_version,
        ).where(PlaceSightingEvidence.sighting_id == sighting_id)
    ).all()
    return {(row.place_id, row.relation_type, row.calculation_version) for row in rows}


def refresh_place_sighting_evidence_for_sighting(
    session: Session, sighting: Sighting
) -> list[PlaceSightingEvidence]:
    """Idempotently upsert community-report associations for one sighting.

    Called from the verification worker each time a report reaches the
    ``screened`` state (or after a ``removal_reported`` event so the row
    can be excluded from active counts). Rebuilding the same rows twice is
    a no-op thanks to the unique constraint on
    ``(sighting_id, place_id, relation_type, calculation_version)``.

    Returns the list of rows that were newly inserted so callers can log
    or emit events. The row-set for eligible relations is captured under
    :data:`COMMUNITY_CALCULATION_VERSION`.
    """
    if sighting.status not in {"screened", "removal_reported"}:
        return []
    calc_version = COMMUNITY_CALCULATION_VERSION
    geography = _sighting_geography(sighting)
    existing = _existing_relations(session, sighting.id)
    inserted: list[PlaceSightingEvidence] = []

    # 1. Area associations - inside boundary OR within 1000 m buffer.
    area_rows = session.execute(
        select(
            MonitoredArea,
            func.ST_Distance(MonitoredArea.geometry, geography).label("distance_m"),
            func.ST_Covers(MonitoredArea.geometry, geography).label("inside"),
        )
        .where(
            func.ST_DWithin(MonitoredArea.geometry, geography, AREA_NEARBY_BUFFER_M)
        )
        .order_by("distance_m")
    ).all()
    for area, distance_m, inside in area_rows:
        if not area.name:
            continue
        place_type = _classify_area(area.name, area.metadata_json or {})
        if place_type is None:
            continue
        relation = "inside_boundary" if inside else "nearby_buffer"
        key = (area.id, relation, calc_version)
        if key in existing:
            continue
        row = PlaceSightingEvidence(
            place_type=place_type,
            place_id=area.id,
            sighting_id=sighting.id,
            species_id=sighting.species_id,
            relation_type=relation,
            straight_line_distance_m=Decimal(f"{float(distance_m):.2f}"),
            geometry_version=str((area.metadata_json or {}).get("geometry_version", "unknown")),
            calculation_version=calc_version,
        )
        session.add(row)
        inserted.append(row)

    # 2. Trail associations - within 750 m.
    trail_rows = session.execute(
        select(
            Trail,
            func.ST_Distance(Trail.geometry, geography).label("distance_m"),
        )
        .where(func.ST_DWithin(Trail.geometry, geography, TRAIL_BUFFER_M))
        .order_by("distance_m")
    ).all()
    for trail, distance_m in trail_rows:
        if not trail.name:
            continue
        key = (trail.id, "nearby_buffer", calc_version)
        if key in existing:
            continue
        row = PlaceSightingEvidence(
            place_type="trail",
            place_id=trail.id,
            sighting_id=sighting.id,
            species_id=sighting.species_id,
            relation_type="nearby_buffer",
            straight_line_distance_m=Decimal(f"{float(distance_m):.2f}"),
            geometry_version=str((trail.metadata_json or {}).get("geometry_version", "unknown")),
            calculation_version=calc_version,
        )
        session.add(row)
        inserted.append(row)

    # 3. Optional upstream_waterway associations use the persisted
    # place-snap cache built during OSM preprocessing. That cache is not
    # yet materialised for community sightings; leave the branch as a
    # documented gap rather than infer directional evidence without the
    # sourced water trait check on the species side.
    #
    # See handover §4: "calculate optional downstream associations using
    # the already imported graph and persisted place snaps". Implemented
    # in a follow-up once the place-snap cache lands.

    if inserted:
        session.flush()
    return inserted


def delete_place_sighting_evidence_for_sighting(
    session: Session, sighting_id: uuid.UUID
) -> int:
    """Remove all community-evidence rows for one sighting.

    Called when a sighting is deleted or fails re-screening. When a
    sighting becomes ``removal_reported`` we keep its rows but exclude
    them from active-report counts at query time.
    """
    result = session.execute(
        delete(PlaceSightingEvidence).where(PlaceSightingEvidence.sighting_id == sighting_id)
    )
    return int(result.rowcount or 0)


def community_report_summaries_for_place(
    session: Session,
    *,
    place_id: uuid.UUID,
    place_type: str,
    include_removed: bool = False,
) -> Iterable[dict]:
    """Return community-report evidence per species for one place.

    Rows for sightings whose status is ``removal_reported`` are preserved
    as historical community evidence but excluded from ``activeReports``
    unless ``include_removed`` is set. Never merge these counts into the
    historical GBIF-derived totals.
    """
    join = PlaceSightingEvidence.sighting_id == Sighting.id
    rows = session.execute(
        select(
            PlaceSightingEvidence.species_id,
            Sighting.status,
            PlaceSightingEvidence.relation_type,
            PlaceSightingEvidence.straight_line_distance_m,
        )
        .join(Sighting, join)
        .where(
            PlaceSightingEvidence.place_id == place_id,
            PlaceSightingEvidence.place_type == place_type,
            PlaceSightingEvidence.calculation_version == COMMUNITY_CALCULATION_VERSION,
        )
    ).all()
    aggregates: dict[str, dict] = {}
    for species_id, status, relation, distance in rows:
        bucket = aggregates.setdefault(
            species_id,
            {
                "speciesId": species_id,
                "activeReports": 0,
                "removalReports": 0,
                "relations": set(),
                "nearestDistanceM": None,
                "sourceLabel": "Community report - not expert validated",
            },
        )
        bucket["relations"].add(relation)
        if distance is not None:
            current = bucket["nearestDistanceM"]
            distance_value = float(distance)
            if current is None or distance_value < current:
                bucket["nearestDistanceM"] = distance_value
        if status == "removal_reported":
            bucket["removalReports"] += 1
        elif status in {"screened"}:
            bucket["activeReports"] += 1
    for bucket in aggregates.values():
        bucket["relations"] = sorted(bucket["relations"])
        if not include_removed and bucket["activeReports"] == 0:
            continue
        yield bucket
