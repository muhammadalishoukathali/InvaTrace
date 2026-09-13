"""One-off/occasional importer for OSM place data (parks, reserves, trails).

Reads a Malaysia-clipped .osm.pbf extract with pyosmium and loads named
parks/forests/reserves as MonitoredArea rows and named paths/tracks as
Trail rows. These feed app/domain/place_association.py, which snaps a
sighting's raw lat/lng to a human-readable place name. Invoked via the
`import-osm` CLI command in app/cli.py, not from the API.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

import osmium
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.data_release import DataRelease, validate_data_release
from app.db.models import MonitoredArea, OsmImport, Trail
from app.geojson_validation import CountryPolygon, country_polygons, geometry_within_country

# Which OSM tag pairs count as an "area" worth importing, and which highway
# types count as a walkable "trail". Anything else in the extract gets skipped.
AREA_TAGS = {
    ("leisure", "park"),
    ("leisure", "nature_reserve"),
    ("boundary", "national_park"),
    ("boundary", "protected_area"),
    ("landuse", "forest"),
    ("natural", "wood"),
}
TRAIL_HIGHWAYS = {"path", "footway", "track"}


class MalaysiaOsmHandler(osmium.SimpleHandler):
    """pyosmium visitor that streams through the .pbf and inserts matching
    areas/ways as it goes, rather than loading the whole extract into memory
    first. See import_malaysia_pbf() below for how this gets invoked."""

    def __init__(
        self,
        session: Session,
        *,
        source_date: datetime,
        geometry_version: str,
        source_release: DataRelease,
        boundary_release: DataRelease,
        malaysia_boundary: list[CountryPolygon],
    ) -> None:
        super().__init__()
        self.session = session
        self.factory = osmium.geom.WKTFactory()
        self.geojson_factory = osmium.geom.GeoJSONFactory()
        self.area_count = 0
        self.trail_count = 0
        self.source_date = source_date
        self.geometry_version = geometry_version
        self.source_release = source_release
        self.boundary_release = boundary_release
        self.malaysia_boundary = malaysia_boundary
        self.outside_country_count = 0
        self.invalid_geometry_count = 0

    def area(self, area) -> None:
        tags = area.tags
        name = tags.get("name")
        if not name:
            return
        # AC Iteration 1 P10 - remember which allow-listed tag pair matched
        # so place_association._categorise can recover it later. Previously
        # the importer only stored generic "osmType": "area", which meant the
        # nearest-feature lookup could never classify a stored row and always
        # returned None even when a park was clearly within 5 km.
        matched_tag = next(
            ((key, value) for key, value in AREA_TAGS if tags.get(key) == value),
            None,
        )
        if matched_tag is None:
            return
        try:
            wkt = self.factory.create_multipolygon(area)
            geojson = json.loads(self.geojson_factory.create_multipolygon(area))
        except (RuntimeError, osmium.InvalidLocationError):
            # Some OSM geometry is malformed or references missing nodes -
            # just skip it rather than blow up the whole import.
            self.invalid_geometry_count += 1
            return
        if not geometry_within_country(geojson, self.malaysia_boundary):
            self.outside_country_count += 1
            return
        object_type = "way" if area.from_way() else "relation"
        osm_reference = f"{object_type}/{area.orig_id()}"
        stable_id = self._stable_place_id(osm_reference)
        label = self._unique_label(name, MonitoredArea, osm_reference, stable_id)
        tag_key, tag_value = matched_tag
        values = {
            "name": label,
            "geometry": func.ST_GeogFromText(f"SRID=4326;{wkt}"),
            "metadata_json": {
                "source": "OpenStreetMap",
                "osmType": "area",
                "source_identifier": osm_reference,
                "source_url": f"https://www.openstreetmap.org/{osm_reference}",
                "osmId": str(area.orig_id()),
                "source_date": self.source_date.isoformat(),
                "geometry_version": self.geometry_version,
                "processed_data_version": self.geometry_version,
                "retrieved_at": self.source_release.retrieved_at,
                "geometry_status": "available",
                # Store the OSM tag pair directly so nearest_osm_feature's
                # allow-list check (park / forest / wood) works against
                # imported data without re-fetching from OSM.
                "tags": {tag_key: tag_value},
                "licence": self.source_release.licence,
                "licence_url": self.source_release.licence_url,
                "country_boundary_sha256": self.boundary_release.sha256,
            },
        }
        existing = self.session.get(MonitoredArea, stable_id)
        if existing is None:
            self.session.add(MonitoredArea(id=stable_id, **values))
        else:
            for key, value in values.items():
                setattr(existing, key, value)
        self.session.flush()
        self.area_count += 1

    def way(self, way) -> None:
        tags = way.tags
        name = tags.get("name")
        if (
            not name
            or tags.get("highway") not in TRAIL_HIGHWAYS
            or tags.get("access") in {"private", "no"}
        ):
            return
        try:
            line = self.factory.create_linestring(way)
            geojson = json.loads(self.geojson_factory.create_linestring(way))
        except (RuntimeError, osmium.InvalidLocationError):
            self.invalid_geometry_count += 1
            return
        if not line.startswith("LINESTRING"):
            self.invalid_geometry_count += 1
            return
        if not geometry_within_country(geojson, self.malaysia_boundary):
            self.outside_country_count += 1
            return
        # Trail.geometry is a MULTILINESTRING column (so a trail can later be
        # made of several disjoint segments), so wrap the single line we get here.
        multiline = f"MULTILINESTRING({line.removeprefix('LINESTRING')})"
        osm_reference = f"way/{way.id}"
        stable_id = self._stable_place_id(osm_reference)
        label = self._unique_label(name, Trail, osm_reference, stable_id)
        values = {
            "name": label,
            "geometry": func.ST_GeogFromText(f"SRID=4326;{multiline}"),
            "metadata_json": {
                "source": "OpenStreetMap",
                "osmType": "way",
                "source_identifier": osm_reference,
                "source_url": f"https://www.openstreetmap.org/{osm_reference}",
                "osmId": str(way.id),
                "source_date": self.source_date.isoformat(),
                "geometry_version": self.geometry_version,
                "processed_data_version": self.geometry_version,
                "retrieved_at": self.source_release.retrieved_at,
                "geometry_status": "available",
                # AC Iteration 1 P10 - preserve the highway tag so
                # place_association.nearest_osm_feature's allow-list
                # (path / footway / track) can classify the row.
                "tags": {"highway": tags.get("highway")},
                "licence": self.source_release.licence,
                "licence_url": self.source_release.licence_url,
                "country_boundary_sha256": self.boundary_release.sha256,
            },
        }
        existing = self.session.get(Trail, stable_id)
        if existing is None:
            self.session.add(Trail(id=stable_id, **values))
        else:
            for key, value in values.items():
                setattr(existing, key, value)
        self.session.flush()
        self.trail_count += 1

    @staticmethod
    def _stable_place_id(osm_reference: str) -> uuid.UUID:
        return uuid.uuid5(uuid.NAMESPACE_URL, f"https://www.openstreetmap.org/{osm_reference}")

    def _unique_label(self, name: str, model, osm_reference: str, stable_id: uuid.UUID) -> str:
        # OSM has plenty of duplicate place names (multiple "Taman"s etc) - rather
        # than silently overwrite/skip, disambiguate the second one onward with
        # its OSM id so both stay visible and queryable.
        existing = self.session.scalar(
            select(model.id).where(model.name == name, model.id != stable_id)
        )
        return name if not existing else f"{name} · OSM {osm_reference}"


def import_malaysia_pbf(
    session: Session,
    *,
    source_path: Path,
    source_date: datetime,
    release_manifest_path: Path,
    country_boundary_path: Path,
    country_boundary_manifest_path: Path,
) -> OsmImport:
    """Entry point for the `import-osm` CLI command. Hashes the source file so
    re-running the import with the same extract is a cheap no-op (returns the
    existing OsmImport record) instead of re-inserting everything."""
    if source_path.suffix.lower() != ".pbf":
        raise ValueError("the OSM source must be a Malaysia-clipped .osm.pbf or .pbf file")
    source_release = validate_data_release(
        release_manifest_path, source_path, expected_dataset_id="osm-malaysia-places"
    )
    source_timestamp_value = source_release.metadata.get("source_timestamp")
    if not isinstance(source_timestamp_value, str):
        raise ValueError("OSM release metadata must include source_timestamp")
    release_timestamp = datetime.fromisoformat(source_timestamp_value.replace("Z", "+00:00"))
    if source_date.tzinfo is None or source_date.astimezone(UTC) != release_timestamp.astimezone(
        UTC
    ):
        raise ValueError("source_date must exactly match the release source_timestamp")
    boundary_release = validate_data_release(
        country_boundary_manifest_path,
        country_boundary_path,
        expected_dataset_id="malaysia-national-boundary",
    )
    malaysia_boundary = country_polygons(
        json.loads(country_boundary_path.read_text(encoding="utf-8"))
    )
    digest = bytes.fromhex(source_release.sha256)
    existing = session.scalar(select(OsmImport).where(OsmImport.sha256 == digest))
    if existing:
        return existing
    geometry_version = f"osm-{source_date.date().isoformat()}-{digest.hex()[:12]}"
    handler = MalaysiaOsmHandler(
        session,
        source_date=source_date,
        geometry_version=geometry_version,
        source_release=source_release,
        boundary_release=boundary_release,
        malaysia_boundary=malaysia_boundary,
    )
    # locations=True + flex_mem index keeps node coordinates around in memory as
    # we stream through, which the geometry factory above needs to build ways.
    handler.apply_file(str(source_path), locations=True, idx="flex_mem")
    imported = OsmImport(
        source_name=source_path.name,
        source_date=source_date,
        sha256=digest,
        area_count=handler.area_count,
        trail_count=handler.trail_count,
        metadata_json={
            "source": "OpenStreetMap",
            "license": "ODbL",
            "scope": "Malaysia features selected from the regional Geofabrik extract using the reviewed national boundary",
            "release": source_release.metadata,
            "country_boundary_release": boundary_release.metadata,
            "outside_country_excluded": handler.outside_country_count,
            "invalid_geometry_excluded": handler.invalid_geometry_count,
        },
    )
    session.add(imported)
    session.commit()
    return imported
