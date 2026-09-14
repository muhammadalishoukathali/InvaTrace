"""Reproducibly extract explicit mapped protected areas from a fixed OSM PBF."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import osmium
from shapely import GEOSException
from shapely.geometry import shape
from shapely.prepared import PreparedGeometry, prep

from app.data_release import validate_data_release
from app.geojson_validation import CountrySpatialIndex, country_polygons

APPROVED_PROTECTED_TAGS = (
    ("boundary", "protected_area"),
    ("boundary", "national_park"),
    ("leisure", "nature_reserve"),
)
PRESERVED_TAGS = (
    "boundary",
    "leisure",
    "name",
    "official_name",
    "protect_class",
    "protection_title",
    "operator",
    "website",
    "wikidata",
)


@dataclass(frozen=True)
class ProtectedAreaExtractionResult:
    accepted: int
    excluded: int
    exclusion_reasons: dict[str, int]
    named: int
    unnamed: int
    output_path: Path


def matched_protected_tags(tags: Any) -> list[str]:
    return [f"{key}={value}" for key, value in APPROVED_PROTECTED_TAGS if tags.get(key) == value]


class _ProtectedAreaHandler(osmium.SimpleHandler):
    def __init__(
        self,
        country_index: CountrySpatialIndex,
        country_geometry: PreparedGeometry,
        release_metadata: dict[str, Any],
    ) -> None:
        super().__init__()
        self.factory = osmium.geom.GeoJSONFactory()
        self.country_index = country_index
        self.country_geometry = country_geometry
        self.release_metadata = release_metadata
        self.features: list[dict[str, Any]] = []
        self.seen_ids: set[str] = set()
        self.reasons: Counter[str] = Counter()

    def area(self, area) -> None:
        matched = matched_protected_tags(area.tags)
        if not matched:
            return
        object_type = "way" if area.from_way() else "relation"
        source_id = f"{object_type}/{area.orig_id()}"
        if source_id in self.seen_ids:
            self.reasons["duplicate_osm_id"] += 1
            return
        self.seen_ids.add(source_id)
        try:
            geometry = json.loads(self.factory.create_multipolygon(area))
        except (RuntimeError, osmium.InvalidLocationError, json.JSONDecodeError):
            self.reasons["invalid_or_incomplete_geometry"] += 1
            return
        if not self.country_index.geometry_within(geometry):
            # Cross-border polygons are excluded rather than silently clipped;
            # this keeps every retained geometry byte-for-byte traceable to OSM.
            self.reasons["outside_or_cross_border_malaysia"] += 1
            return
        try:
            fully_covered = self.country_geometry.covers(shape(geometry))
        except GEOSException:
            self.reasons["invalid_or_incomplete_geometry"] += 1
            return
        if not fully_covered:
            self.reasons["outside_or_cross_border_malaysia"] += 1
            return
        tags = {key: area.tags.get(key) for key in PRESERVED_TAGS if area.tags.get(key)}
        name = area.tags.get("name")
        official_name = area.tags.get("official_name")
        self.features.append(
            {
                "type": "Feature",
                "id": source_id,
                "properties": {
                    "source_id": source_id,
                    "osm_type": object_type,
                    "osm_id": str(area.orig_id()),
                    "source_url": f"https://www.openstreetmap.org/{source_id}",
                    "name": name,
                    "official_name": official_name,
                    "protect_class": area.tags.get("protect_class"),
                    "protection_title": area.tags.get("protection_title"),
                    "matched_tags": matched,
                    "tags": tags,
                    "source": self.release_metadata["source"],
                    "source_version": self.release_metadata["upstream_version"],
                    "source_timestamp": self.release_metadata["source_timestamp"],
                },
                "geometry": geometry,
            }
        )


def extract_osm_protected_areas(
    *,
    source_path: Path,
    output_path: Path,
    release_manifest_path: Path,
    country_boundary_path: Path,
    country_boundary_manifest_path: Path,
) -> ProtectedAreaExtractionResult:
    """Create a deterministic, Malaysia-only protected-area GeoJSON release."""
    source_release = validate_data_release(
        release_manifest_path, source_path, expected_dataset_id="osm-malaysia-places"
    )
    if not isinstance(source_release.metadata.get("source_timestamp"), str):
        raise ValueError("OSM release metadata must include source_timestamp")
    boundary_release = validate_data_release(
        country_boundary_manifest_path,
        country_boundary_path,
        expected_dataset_id="malaysia-national-boundary",
    )
    if source_release.metadata.get("country_boundary_sha256") != boundary_release.sha256:
        raise ValueError("OSM and country-boundary releases are not cryptographically linked")
    boundary = json.loads(country_boundary_path.read_text(encoding="utf-8"))
    boundary_features = boundary.get("features") if isinstance(boundary, dict) else None
    if not isinstance(boundary_features, list) or len(boundary_features) != 1:
        raise ValueError("country boundary release must contain exactly one feature")
    boundary_feature = boundary_features[0]
    if not isinstance(boundary_feature, dict) or not isinstance(
        boundary_feature.get("geometry"), dict
    ):
        raise ValueError("country boundary feature must contain a geometry")
    handler = _ProtectedAreaHandler(
        CountrySpatialIndex(country_polygons(boundary)),
        prep(shape(boundary_feature["geometry"])),
        source_release.metadata,
    )
    handler.apply_file(str(source_path), locations=True, idx="flex_mem")
    handler.features.sort(key=lambda feature: feature["id"])
    named = sum(
        bool(feature["properties"].get("name") or feature["properties"].get("official_name"))
        for feature in handler.features
    )
    payload = {
        "type": "FeatureCollection",
        "metadata": {
            "dataset_id": "osm-malaysia-protected-areas",
            "source": source_release.source,
            "source_url": source_release.source_url,
            "source_version": source_release.upstream_version,
            "source_timestamp": source_release.metadata["source_timestamp"],
            "source_sha256": source_release.sha256,
            "licence": source_release.licence,
            "licence_url": source_release.licence_url,
            "approved_tag_allowlist": [f"{key}={value}" for key, value in APPROVED_PROTECTED_TAGS],
            "cross_border_policy": "exclude_without_clipping",
            "exclusion_reasons": dict(sorted(handler.reasons.items())),
        },
        "features": handler.features,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return ProtectedAreaExtractionResult(
        accepted=len(handler.features),
        excluded=sum(handler.reasons.values()),
        exclusion_reasons=dict(sorted(handler.reasons.items())),
        named=named,
        unnamed=len(handler.features) - named,
        output_path=output_path,
    )
