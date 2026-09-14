"""Focused place-discovery checks against a real PostgreSQL/PostGIS database."""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import func, select

from app.api.routers.places import SPATIAL_BOUNDARY_EPSILON_M, place_map
from app.db.base import SessionLocal
from app.db.models import MonitoredArea, Trail

pytestmark = pytest.mark.integration

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
            min_lon=100.999,
            min_lat=2.999,
            max_lon=101.011,
            max_lat=3.011,
            place_type=["forest"],
            session=session,
        )
        assert [feature.id for feature in forest_only.features] == [area_id]
        trail_only = place_map(
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
        assert session.scalar(
            select(
                func.ST_DWithin(
                    origin,
                    projected,
                    distance_m + SPATIAL_BOUNDARY_EPSILON_M,
                )
            )
        ) is True
        assert session.scalar(select(func.ST_Distance(origin, projected))) == pytest.approx(
            distance_m, abs=0.02
        )
