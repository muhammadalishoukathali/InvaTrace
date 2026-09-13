"""Turns a bare lat/lng into a human-readable place label for a sighting.

Nobody wants to read "3.12345, 101.6789" on a sighting card, so this looks
up whatever OSM-imported area/trail the point falls inside (or is near),
and falls back through a couple of tiers if nothing matches. Called once
per report during screening (see the reporting/screening worker) and the
label gets stored on Sighting.place_label rather than recomputed per read.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from geoalchemy2 import Geography
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from app.db.models import MonitoredArea, MonitoredPlace, Trail

# AC 4.3.1 - only these OSM feature classes count toward the stored nearest
# result. Anything else in the imported data (roads, farmland, water) is
# ignored so the surfaced label is genuinely useful for a field volunteer.
_TRAIL_CATEGORIES = {"path", "footway", "track"}
_AREA_CATEGORIES = {"park", "forest", "wood"}
_NEAREST_RADIUS_M = 5_000
# AC Iteration 1 P10 - how many nearest candidates per table to fetch before
# giving up. Small enough to keep the SQL cheap; large enough that a handful
# of non-allow-listed neighbours (nature_reserve etc.) do not hide a real
# park a bit further out.
_NEAREST_CANDIDATE_LIMIT = 20


@dataclass(frozen=True)
class NearestOsmFeature:
    """The nearest named OSM thing within 5km that we actually want to show
    on a sighting (AC 4.3.1).

    distance_m is the PostGIS geography distance from the reported point to
    the feature's geometry, rounded to 2dp so we're not storing meaningless
    precision. feature_type is whichever OSM tag value (highway/leisure/
    landuse/natural) got the feature into our small allow-list - so it'll
    be one of path, footway, track, park, forest, wood. Anything else we
    just ignore.
    """

    feature_type: str
    name: str
    distance_m: float


@dataclass(frozen=True)
class AssociatedPlace:
    display_name: str
    area_id: uuid.UUID | None
    area_name: str | None
    trail_id: uuid.UUID | None
    trail_name: str | None
    # where the match came from: "osm" (area/trail), "seed" (hand-entered
    # MonitoredPlace), or "fallback" (nothing nearby, generic label)
    source: str


def associate_place(
    session: Session, *, latitude: float, longitude: float, accuracy_m: int | None
) -> AssociatedPlace:
    """Best-effort place lookup, tried in order: OSM area/trail, then a seeded
    place within 5km, then a generic "somewhere in Malaysia" fallback so the
    caller always gets something to display.
    """
    point = func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326)
    geography = cast(point, Geography("POINT", srid=4326))
    # smallest covering area wins - if a point falls inside a big national
    # park that itself contains a smaller reserve, we want the specific one
    area = session.execute(
        select(MonitoredArea, func.ST_Area(MonitoredArea.geometry))
        .where(func.ST_Covers(MonitoredArea.geometry, geography))
        .order_by(func.ST_Area(MonitoredArea.geometry))
        .limit(1)
    ).first()
    # search radius scales with the report's own GPS accuracy (worse accuracy
    # -> search wider), clamped so we're never searching an unreasonably
    # small or large radius regardless of what the device reported
    trail_radius = min(250, max(100, (accuracy_m or 50) * 2))
    trail = session.execute(
        select(Trail, func.ST_Distance(Trail.geometry, geography))
        .where(func.ST_DWithin(Trail.geometry, geography, trail_radius))
        .order_by(func.ST_Distance(Trail.geometry, geography))
        .limit(1)
    ).first()
    if area or trail:
        area_item = area[0] if area else None
        trail_item = trail[0] if trail else None
        # a point can be inside an area AND near a trail at once (e.g. "Bukit
        # Kiara · Main Trail") - join whichever of the two we actually found
        label = " · ".join(
            value
            for value in (
                area_item.name if area_item else None,
                trail_item.name if trail_item else None,
            )
            if value
        )
        return AssociatedPlace(
            display_name=label,
            area_id=area_item.id if area_item else None,
            area_name=area_item.name if area_item else None,
            trail_id=trail_item.id if trail_item else None,
            trail_name=trail_item.name if trail_item else None,
            source="osm",
        )

    # no OSM coverage nearby - fall back to the small hand-seeded list before
    # giving up entirely
    seeded = session.execute(
        select(MonitoredPlace, func.ST_Distance(MonitoredPlace.location, geography))
        .where(func.ST_DWithin(MonitoredPlace.location, geography, 5_000))
        .order_by(func.ST_Distance(MonitoredPlace.location, geography))
        .limit(1)
    ).first()
    if seeded:
        return AssociatedPlace(seeded[0].name, None, None, None, None, "seed")
    return AssociatedPlace("Reported location, Malaysia", None, None, None, None, "fallback")


def nearest_osm_feature(
    session: Session, *, latitude: float, longitude: float
) -> NearestOsmFeature | None:
    """Finds the actual nearest named trail or park/forest area within 5km
    of the point, looking at both the trail lines table (paths/footways/
    tracks) and the polygon areas table (park/forest/wood). Returns None
    if nothing named in our allow-list is close enough - in that case the
    screening worker just leaves the columns null on the sighting and the
    detail panel shows "No named trail, park or forest found nearby".

    Distance is computed against the imported OSM geometry, not against
    whatever fuzzy public location we eventually show on the map. The idea
    here is that the stored value is the source of truth - if the client
    ever does its own live lookup it's only for extra context, we don't
    trust it to override what we saved (AC 4.3.1).
    """
    point = func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326)
    geography = cast(point, Geography("POINT", srid=4326))
    candidates: list[NearestOsmFeature] = []

    # AC Iteration 1 P10 - fetch the nearest N candidates per table and pick
    # the first one whose metadata categorises into the allow-list, instead
    # of taking only LIMIT 1. Previously, a nearby feature with tags that
    # fall outside the allow-list (e.g. an OSM nature_reserve area next to a
    # walking park) short-circuited the lookup with `category is None`, and
    # the further-away allow-listed feature was never surfaced.
    trail_rows = session.execute(
        select(
            Trail.name,
            Trail.metadata_json,
            func.ST_Distance(Trail.geometry, geography),
        )
        .where(
            Trail.name.is_not(None),
            func.ST_DWithin(Trail.geometry, geography, _NEAREST_RADIUS_M),
        )
        .order_by(func.ST_Distance(Trail.geometry, geography), Trail.id)
        .limit(_NEAREST_CANDIDATE_LIMIT)
    ).all()
    for row in trail_rows:
        category = _categorise(row[1] or {}, _TRAIL_CATEGORIES)
        if category is not None:
            candidates.append(NearestOsmFeature(category, row[0], round(float(row[2]), 2)))
            break

    area_rows = session.execute(
        select(
            MonitoredArea.name,
            MonitoredArea.metadata_json,
            func.ST_Distance(MonitoredArea.geometry, geography),
        )
        .where(
            MonitoredArea.name.is_not(None),
            func.ST_DWithin(MonitoredArea.geometry, geography, _NEAREST_RADIUS_M),
        )
        .order_by(func.ST_Distance(MonitoredArea.geometry, geography), MonitoredArea.id)
        .limit(_NEAREST_CANDIDATE_LIMIT)
    ).all()
    for row in area_rows:
        category = _categorise(row[1] or {}, _AREA_CATEGORIES)
        if category is not None:
            candidates.append(NearestOsmFeature(category, row[0], round(float(row[2]), 2)))
            break

    if not candidates:
        return None
    # Tie-break: shortest distance wins; equal distances prefer trail (path)
    # over area because a named trail is more specific field-guidance context.
    candidates.sort(
        key=lambda feature: (feature.distance_m, feature.feature_type not in _TRAIL_CATEGORIES)
    )
    return candidates[0]


def _categorise(metadata: dict, allowed: set[str]) -> str | None:
    """Different versions of the OSM importer dumped tags into metadata_json
    under slightly different keys, so we just try the common ones in order
    and return the first value that's in our allow-list. Bit ugly but it's
    the price of not re-importing all the OSM data every time we tweak the
    importer."""
    for key in ("highway", "leisure", "landuse", "natural", "category", "type"):
        raw = metadata.get(key)
        if isinstance(raw, str) and raw in allowed:
            return raw
    tags = metadata.get("tags")
    if isinstance(tags, dict):
        for key, value in tags.items():
            if (
                isinstance(value, str)
                and value in allowed
                and key in {"highway", "leisure", "landuse", "natural"}
            ):
                return value
    return None
