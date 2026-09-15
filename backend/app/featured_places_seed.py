"""Seed a curated set of real KL/Selangor parks, forests, woodlands and trails.

Backend-of-last-resort so a green-field prod DB shows something on the map and
Browse-places screen before the full Malaysia OSM PBF has been imported. Each
row is idempotent by ``name`` (existing rows are left untouched) and carries
enough OSM-style metadata_json for the /api/v1/places router to classify it
into the right frontend bucket.

Rows come from public wikipedia/OSM sources; polygons are coarse ~250m boxes
around a real centre point, chosen to keep the file small and human-auditable.
Once the real OSM PBF is imported these seeded rows can be deleted safely -
the importer keys off ``metadata_json.source == 'openstreetmap'`` and skips
anything else.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db.models import MonitoredArea, Trail


@dataclass(frozen=True)
class FeaturedArea:
    name: str
    lon: float
    lat: float
    kind: str  # "park" | "forest" | "wood"
    display_type: str


@dataclass(frozen=True)
class FeaturedTrail:
    name: str
    points: Sequence[tuple[float, float]]
    display_type: str


FEATURED_AREAS: tuple[FeaturedArea, ...] = (
    # Forests (landuse=forest)
    FeaturedArea("Bukit Nanas Forest Reserve", 101.7005, 3.1478, "forest", "Forest reserve"),
    FeaturedArea("FRIM Kepong", 101.6349, 3.2364, "forest", "Forest reserve"),
    FeaturedArea("Bukit Kiara Federal Park", 101.6438, 3.1442, "forest", "Forest reserve"),
    FeaturedArea("Bukit Gasing Forest Park", 101.6488, 3.0972, "forest", "Forest reserve"),
    FeaturedArea("Ampang Forest Reserve", 101.7692, 3.1610, "forest", "Forest reserve"),
    # Woodlands (natural=wood)
    FeaturedArea("Rimba Ilmu Woodland (UM)", 101.6558, 3.1256, "wood", "Botanical woodland"),
    FeaturedArea("Bukit Cerakah Woodland", 101.5211, 3.1017, "wood", "Community woodland"),
    # Parks (default)
    FeaturedArea("KLCC Park", 101.7135, 3.1573, "park", "City park"),
    FeaturedArea("Taman Tugu", 101.6822, 3.1497, "park", "Urban park"),
    FeaturedArea("Perdana Botanical Garden", 101.6864, 3.1425, "park", "Botanical garden"),
    FeaturedArea("Taman Tasik Titiwangsa", 101.7076, 3.1783, "park", "Lake park"),
    FeaturedArea("Taman Tasik Permaisuri", 101.7133, 3.0925, "park", "Lake park"),
    FeaturedArea("Kepong Metropolitan Park", 101.6333, 3.2075, "park", "Metropolitan park"),
    FeaturedArea("Desa ParkCity Central Park", 101.6303, 3.1912, "park", "Urban park"),
    FeaturedArea("Bukit Jalil Recreational Park", 101.6913, 3.0563, "park", "Recreational park"),
    FeaturedArea("Taman Botani Negara Shah Alam", 101.5350, 3.1017, "park", "Botanical park"),
    FeaturedArea("Taman Pertanian Malaysia Bukit Cahaya", 101.4917, 3.0567, "park", "Agricultural park"),
    FeaturedArea("Putrajaya Botanical Garden", 101.6900, 2.9333, "park", "Botanical garden"),
)


FEATURED_TRAILS: tuple[FeaturedTrail, ...] = (
    FeaturedTrail(
        "FRIM Canopy Walkway Trail",
        ((101.6320, 3.2350), (101.6349, 3.2364), (101.6378, 3.2380)),
        "Canopy trail",
    ),
    FeaturedTrail(
        "Bukit Kiara Mountain Bike Trail",
        ((101.6410, 3.1420), (101.6438, 3.1442), (101.6466, 3.1464), (101.6488, 3.1478)),
        "MTB trail",
    ),
    FeaturedTrail(
        "Bukit Gasing Trail",
        ((101.6470, 3.0958), (101.6488, 3.0972), (101.6506, 3.0986)),
        "Hiking trail",
    ),
    FeaturedTrail(
        "Broga Hill Trail",
        ((101.9128, 2.9218), (101.9155, 2.9238), (101.9182, 2.9256)),
        "Hill trail",
    ),
    FeaturedTrail(
        "Bukit Tabur East Ridge",
        ((101.7738, 3.2210), (101.7768, 3.2224), (101.7802, 3.2242)),
        "Ridge trail",
    ),
)


def _box_ewkt(lon: float, lat: float, half_deg: float = 0.00125) -> str:
    """Return a WKT MULTIPOLYGON for a small square box around (lon, lat).

    ~0.00125 deg ≈ 138m at the equator; the output stays a valid, closed ring
    without needing shapely on the path (this seed runs from the CLI process,
    not the web dyno, so keeping the dependency surface small matters).
    """
    w = lon - half_deg
    e = lon + half_deg
    s = lat - half_deg
    n = lat + half_deg
    return (
        f"MULTIPOLYGON((("
        f"{w:.6f} {s:.6f},{e:.6f} {s:.6f},{e:.6f} {n:.6f},{w:.6f} {n:.6f},{w:.6f} {s:.6f}"
        f")))"
    )


def _line_ewkt(points: Sequence[tuple[float, float]]) -> str:
    coords = ",".join(f"{lon:.6f} {lat:.6f}" for lon, lat in points)
    return f"MULTILINESTRING(({coords}))"


def _area_metadata(area: FeaturedArea) -> dict:
    # Tags mirror the OSM-native shape the /places router indexes.
    tags: dict[str, str] = {}
    if area.kind == "forest":
        tags["landuse"] = "forest"
    elif area.kind == "wood":
        tags["natural"] = "wood"
    else:
        tags["leisure"] = "park"
    return {
        "source": "invatrace-featured-seed-v1",
        "geometry_status": "available",
        "geometry_version": "featured-seed-2026-09-15",
        "display_type": area.display_type,
        "tags": tags,
    }


def _trail_metadata(trail: FeaturedTrail) -> dict:
    return {
        "source": "invatrace-featured-seed-v1",
        "geometry_status": "available",
        "geometry_version": "featured-seed-2026-09-15",
        "display_type": trail.display_type,
        "tags": {"highway": "path"},
    }


def seed_featured_places(session: Session) -> tuple[int, int]:
    """Insert the featured area + trail set. Returns (areas_added, trails_added)."""
    from sqlalchemy import select, func

    areas_added = 0
    existing_area_names = set(
        session.scalars(select(MonitoredArea.name)).all()
    )
    for area in FEATURED_AREAS:
        if area.name in existing_area_names:
            continue
        session.add(
            MonitoredArea(
                name=area.name,
                geometry=func.ST_GeogFromText(f"SRID=4326;{_box_ewkt(area.lon, area.lat)}"),
                metadata_json=_area_metadata(area),
            )
        )
        areas_added += 1

    trails_added = 0
    existing_trail_names = set(session.scalars(select(Trail.name)).all())
    for trail in FEATURED_TRAILS:
        if trail.name in existing_trail_names:
            continue
        session.add(
            Trail(
                name=trail.name,
                geometry=func.ST_GeogFromText(f"SRID=4326;{_line_ewkt(trail.points)}"),
                metadata_json=_trail_metadata(trail),
            )
        )
        trails_added += 1

    session.commit()
    return areas_added, trails_added
