"""Focused place-discovery checks against a real PostgreSQL/PostGIS database."""

from __future__ import annotations

import os
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.api.routers.places import SPATIAL_BOUNDARY_EPSILON_M, place_map
from app.db.base import SessionLocal
from app.db.models import MonitoredArea, Trail

pytestmark = pytest.mark.integration


def _rate_limit_request() -> SimpleNamespace:
    return SimpleNamespace(client=SimpleNamespace(host="test"))


if os.getenv("RUN_INVATRACE_SPATIAL_INTEGRATION") != "1":
    pytest.skip(
        "set RUN_INVATRACE_SPATIAL_INTEGRATION=1 with PostgreSQL/PostGIS available",
        allow_module_level=True,
    )


def test_place_map_uses_postgis_viewport_and_representative_points() -> None:
    area_id = uuid.uuid4()
    trail_id = uuid.uuid4()
    unavailable_id = uuid.uuid4()
    unvalidated_id = uuid.uuid4()
    with SessionLocal() as session:
        session.add_all(
            [
                MonitoredArea(
                    id=area_id,
                    name=f"Integration Forest {area_id}",
                    geometry=func.ST_GeogFromText(
                        "SRID=4326;MULTIPOLYGON(((101.000 3.000,101.010 3.000,101.010 3.010,101.000 3.010,101.000 3.000)))"
                    ),
                    metadata_json={
                        "geometry_status": "available",
                        "source": "PostGIS integration fixture",
                        "geometry_version": "integration-v1",
                        "tags": {"landuse": "forest"},
                    },
                ),
                Trail(
                    id=trail_id,
                    name=f"Integration Trail {trail_id}",
                    geometry=func.ST_GeogFromText(
                        "SRID=4326;MULTILINESTRING((101.002 3.002,101.008 3.008))"
                    ),
                    metadata_json={
                        "geometry_status": "available",
                        "source": "PostGIS integration fixture",
                        "geometry_version": "integration-v1",
                        "tags": {"highway": "path"},
                    },
                ),
                MonitoredArea(
                    id=unavailable_id,
                    name=f"Unavailable Wood {unavailable_id}",
                    geometry=func.ST_GeogFromText(
                        "SRID=4326;MULTIPOLYGON(((101.003 3.003,101.004 3.003,101.004 3.004,101.003 3.004,101.003 3.003)))"
                    ),
                    metadata_json={
                        "geometry_status": "point_only",
                        "source": "PostGIS integration fixture",
                        "geometry_version": "integration-v1",
                        "tags": {"natural": "wood"},
                    },
                ),
                MonitoredArea(
                    id=unvalidated_id,
                    name=f"Unvalidated Park {unvalidated_id}",
                    geometry=func.ST_GeogFromText(
                        "SRID=4326;MULTIPOLYGON(((101.005 3.005,101.006 3.005,101.006 3.006,101.005 3.006,101.005 3.005)))"
                    ),
                    metadata_json={
                        "source": "PostGIS integration fixture",
                        "geometry_version": "integration-v1",
                    },
                ),
            ]
        )
        session.commit()
        result = place_map(
            _rate_limit_request(),
            min_lon=100.999,
            min_lat=2.999,
            max_lon=101.011,
            max_lat=3.011,
            place_type=None,
            session=session,
        )
        by_id = {feature.id: feature for feature in result.features}
        assert area_id in by_id
        assert trail_id in by_id
        assert unavailable_id not in by_id
        assert unvalidated_id not in by_id
        assert by_id[area_id].properties.place_type == "forest"
        assert by_id[trail_id].properties.place_type == "trail"
        assert all(feature.geometry["type"] == "Point" for feature in by_id.values())
        forest_only = place_map(
            _rate_limit_request(),
            min_lon=100.999,
            min_lat=2.999,
            max_lon=101.011,
            max_lat=3.011,
            place_type=["forest"],
            session=session,
        )
        assert [feature.id for feature in forest_only.features] == [area_id]
        trail_only = place_map(
            _rate_limit_request(),
            min_lon=100.999,
            min_lat=2.999,
            max_lon=101.011,
            max_lat=3.011,
            place_type=["trail"],
            session=session,
        )
        assert [feature.id for feature in trail_only.features] == [trail_id]
        session.delete(session.get(MonitoredArea, area_id))
        session.delete(session.get(MonitoredArea, unavailable_id))
        session.delete(session.get(MonitoredArea, unvalidated_id))
        session.delete(session.get(Trail, trail_id))
        session.commit()


@pytest.mark.parametrize("distance_m", [750, 1000])
def test_postgis_geography_includes_exact_buffer_boundary(distance_m: int) -> None:
    with SessionLocal() as session:
        origin = func.ST_GeogFromText("SRID=4326;POINT(101.6412 3.1497)")
        projected = func.ST_Project(origin, distance_m, 1.5707963267948966)
        assert (
            session.scalar(
                select(
                    func.ST_DWithin(
                        origin,
                        projected,
                        distance_m + SPATIAL_BOUNDARY_EPSILON_M,
                    )
                )
            )
            is True
        )
        assert session.scalar(select(func.ST_Distance(origin, projected))) == pytest.approx(
            distance_m, abs=0.02
        )


def test_place_list_shows_one_clean_entry_per_real_place() -> None:
    from app.api.routers.places import list_places

    run = uuid.uuid4().hex[:8]
    trail = f"Dedupe Ridge {run}"
    park = f"Dedupe Park {run}"
    homonym = f"Dedupe Common {run}"
    osm = {"geometry_status": "available", "source": "OpenStreetMap", "geometry_version": "v1"}

    def line(lat: float) -> str:
        return f"SRID=4326;MULTILINESTRING((101.300 {lat:.3f},101.300 {lat + 0.015:.3f}))"

    def square(lon: float, lat: float) -> str:
        return (
            f"SRID=4326;MULTIPOLYGON((({lon} {lat},{lon + 0.01} {lat},{lon + 0.01} {lat + 0.01},"
            f"{lon} {lat + 0.01},{lon} {lat})))"
        )

    trails = [
        Trail(
            id=uuid.uuid4(),
            name=trail if index == 0 else f"{trail} · OSM way/{900 + index}",
            geometry=func.ST_GeogFromText(line(3.300 + index * 0.016)),
            metadata_json={**osm, "tags": {"highway": "path"}},
        )
        for index in range(4)
    ]
    areas = [
        MonitoredArea(
            id=uuid.uuid4(),
            name=park,
            geometry=func.ST_GeogFromText(square(101.40, 3.40)),
            metadata_json={
                **osm,
                "source": "invatrace-featured-seed-v1",
                "tags": {"leisure": "park"},
            },
        ),
        MonitoredArea(
            id=uuid.uuid4(),
            name=f"{park} · OSM relation/77",
            geometry=func.ST_GeogFromText(square(101.405, 3.405)),
            metadata_json={**osm, "tags": {"leisure": "park"}},
        ),
        MonitoredArea(
            id=uuid.uuid4(),
            name=homonym,
            geometry=func.ST_GeogFromText(square(101.50, 3.50)),
            metadata_json={**osm, "tags": {"leisure": "park"}},
        ),
        MonitoredArea(
            id=uuid.uuid4(),
            name=f"{homonym} · OSM way/88",
            geometry=func.ST_GeogFromText(square(103.70, 1.50)),
            metadata_json={**osm, "tags": {"leisure": "park"}},
        ),
    ]
    with SessionLocal() as session:
        session.add_all([*trails, *areas])
        session.commit()
        try:
            items = list_places(_rate_limit_request(), session).items  # type: ignore[arg-type]
            ours = [item for item in items if run in item.display_name]
            names = sorted((item.display_name, item.place_type) for item in ours)
            assert names == sorted(
                [(trail, "trail"), (park, "park"), (homonym, "park"), (homonym, "park")]
            )
            assert all("· OSM" not in item.display_name for item in ours)
            # The whole split trail is one entry, the unsuffixed parent.
            assert next(i for i in ours if i.display_name == trail).place_id == trails[0].id
            # The curated park hides its OSM copy.
            assert next(i for i in ours if i.display_name == park).source.startswith("invatrace")
            hints = sorted(i.location_hint or "" for i in ours if i.display_name == homonym)
            # Two different parks share a name: each says roughly where it is.
            assert hints[0].startswith("Near 1.5") and "103.7" in hints[0]
            assert hints[1].startswith("Near 3.5") and "101.5" in hints[1]
        finally:
            for row in [*trails, *areas]:
                session.delete(row)
            session.commit()
