"""Regression checks for auditable, fail-closed production GIS inputs."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from shapely.geometry import shape

from app.data_release import validate_data_release
from app.geojson_validation import (
    CountrySpatialIndex,
    country_polygons,
    point_in_country,
    validate_polygon_geojson,
)
from app.osm_protected_area import APPROVED_PROTECTED_TAGS, matched_protected_tags
from app.protected_area_import import _coverage_geometry

REPO_ROOT = Path(__file__).resolve().parents[2]
BOUNDARY_ROOT = REPO_ROOT / "data" / "production" / "malaysia-boundary"
OCCURRENCE_ROOT = REPO_ROOT / "data" / "production" / "gbif-occurrences"
PROTECTED_ROOT = REPO_ROOT / "data" / "production" / "osm-protected-areas"
WATERWAY_ROOT = REPO_ROOT / "data" / "production" / "osm-waterways"


def test_reviewed_malaysia_boundary_release_matches_exact_bytes() -> None:
    release = validate_data_release(
        BOUNDARY_ROOT / "release.json",
        BOUNDARY_ROOT / "geoBoundaries-MYS-ADM0.geojson",
        expected_dataset_id="malaysia-national-boundary",
    )
    assert release.source == "geoBoundaries gbOpen"
    assert release.licence == "Open Data Commons Open Database License 1.0"
    assert release.sha256 == "20ffa28d8b7980060d43418a6a4a250ffdbcd805c514189accec9f799a181d77"


def test_reviewed_malaysia_boundary_includes_both_regions_and_excludes_neighbours() -> None:
    payload = json.loads(
        (BOUNDARY_ROOT / "geoBoundaries-MYS-ADM0.geojson").read_text(encoding="utf-8")
    )
    summary = validate_polygon_geojson(payload)
    polygons = country_polygons(payload)
    assert summary.geometry_count == 1
    assert summary.coordinate_count == 85_413
    assert point_in_country(101.6869, 3.1390, polygons)  # Kuala Lumpur
    assert point_in_country(116.0735, 5.9804, polygons)  # Kota Kinabalu
    assert not point_in_country(103.8198, 1.3521, polygons)  # Singapore
    assert not point_in_country(104.0305, 1.1301, polygons)  # Batam, Indonesia
    assert not point_in_country(100.5018, 7.0084, polygons)  # Hat Yai, Thailand


def test_country_spatial_index_preserves_exact_boundary_result() -> None:
    payload = json.loads(
        (BOUNDARY_ROOT / "geoBoundaries-MYS-ADM0.geojson").read_text(encoding="utf-8")
    )
    polygons = country_polygons(payload)
    index = CountrySpatialIndex(polygons)
    coordinates = [position for polygon in polygons for ring in polygon.rings for position in ring]
    samples = coordinates[:: max(1, len(coordinates) // 40)]
    samples.extend([[101.6869, 3.1390], [116.0735, 5.9804], [103.8198, 1.3521], [100.5018, 7.0084]])
    assert all(
        index.contains(float(longitude), float(latitude))
        == point_in_country(float(longitude), float(latitude), polygons)
        for longitude, latitude in samples
    )


def test_protected_area_release_is_explicit_closed_and_auditable() -> None:
    data_path = PROTECTED_ROOT / "osm-malaysia-protected-areas-2026-09-12.geojson"
    release = validate_data_release(
        PROTECTED_ROOT / "release.json",
        data_path,
        expected_dataset_id="osm-malaysia-protected-areas",
    )
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    features = payload["features"]
    allowlist = {f"{key}={value}" for key, value in APPROVED_PROTECTED_TAGS}
    assert release.sha256 == "7883a93720f5ac61adf954af6cfdaa6aa51942fae7bbb86e11d78dcb6b170b51"
    assert len(features) == release.metadata["feature_count"] == 197
    assert len({feature["id"] for feature in features}) == 197
    assert (
        sum(
            bool(feature["properties"].get("name") or feature["properties"].get("official_name"))
            for feature in features
        )
        == 189
    )
    assert all(set(feature["properties"]["matched_tags"]) <= allowlist for feature in features)
    assert all(
        feature["properties"]["source_url"].startswith("https://www.openstreetmap.org/")
        for feature in features
    )
    assert payload["metadata"]["source_sha256"] == release.metadata["source_pbf_sha256"]

    boundary_payload = json.loads(
        (BOUNDARY_ROOT / "geoBoundaries-MYS-ADM0.geojson").read_text(encoding="utf-8")
    )
    country = shape(boundary_payload["features"][0]["geometry"])
    assert all(country.covers(shape(feature["geometry"])) for feature in features)


def test_protected_area_allowlist_rejects_unrelated_area_tags() -> None:
    assert matched_protected_tags({"boundary": "protected_area"}) == ["boundary=protected_area"]
    assert matched_protected_tags({"leisure": "nature_reserve"}) == ["leisure=nature_reserve"]
    assert matched_protected_tags({"boundary": "administrative", "leisure": "park"}) == []


def test_production_boundary_feature_collection_resolves_to_one_multipolygon() -> None:
    payload = json.loads(
        (BOUNDARY_ROOT / "geoBoundaries-MYS-ADM0.geojson").read_text(encoding="utf-8")
    )
    geometry = _coverage_geometry(payload)
    assert geometry["type"] == "MultiPolygon"
    assert geometry == payload["features"][0]["geometry"]


def test_coverage_rejects_ambiguous_multi_feature_collection() -> None:
    with pytest.raises(ValueError, match="exactly one feature"):
        _coverage_geometry({"type": "FeatureCollection", "features": [{}, {}]})


def test_waterway_evidence_release_is_fail_closed_and_traceable() -> None:
    data_path = WATERWAY_ROOT / "osm-waterway-evidence-2026-09-12.json"
    release = validate_data_release(
        WATERWAY_ROOT / "release.json",
        data_path,
        expected_dataset_id="osm-malaysia-waterway-evidence",
    )
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    assert release.sha256 == "cba44ecb1a01700db89d98e3461f7d0b37a0d8333bf9e37326a128cb775cd23c"
    assert payload["sourceSha256"] == release.metadata["source_pbf_sha256"]
    assert payload["countryBoundarySha256"] == release.metadata["country_boundary_sha256"]
    assert payload["includedWaterways"] == ["canal", "drain", "river", "stream"]
    assert payload["graphQa"]["directed_edges"] == 61_118
    assert payload["graphQa"]["invalid_geometries"] == 0
    assert payload["graphQa"]["duplicate_ways"] == 0
    assert payload["records"] == []


def test_gbif_release_is_closed_catalogue_traceable_and_redistributable() -> None:
    data_path = OCCURRENCE_ROOT / "gbif-malaysia-occurrences-2026-09-13.json"
    release = validate_data_release(
        OCCURRENCE_ROOT / "release.json",
        data_path,
        expected_dataset_id="gbif-malaysia-occurrences",
    )
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    approved = {
        record["species_id"]
        for record in json.loads(
            (REPO_ROOT / "shared" / "catalogue" / "approved-species.json").read_text(
                encoding="utf-8"
            )
        )["records"]
    }
    assert release.source == "GBIF Occurrence Search API"
    assert len(payload["query"]["taxa"]) == 32
    assert payload["record_count"] == len(payload["records"]) == 637
    assert {record["speciesId"] for record in payload["records"]} <= approved
    assert len({record["sourceOccurrenceId"] for record in payload["records"]}) == 637
    assert all(
        "creativecommons.org/licenses/by/" in record["license"]
        or "creativecommons.org/publicdomain/zero/" in record["license"]
        for record in payload["records"]
    )


def test_data_release_rejects_content_drift(tmp_path: Path) -> None:
    data_path = tmp_path / "release.json"
    data_path.write_text("{}\n", encoding="utf-8")
    manifest = {
        "schema_version": "invatrace.data-release.v1",
        "dataset_id": "example",
        "source": "Example authority",
        "source_url": "https://example.test/source",
        "upstream_version": "v1",
        "retrieved_at": "2026-09-13",
        "licence": "CC0",
        "licence_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "file": data_path.name,
        "sha256": hashlib.sha256(data_path.read_bytes()).hexdigest(),
        "byte_length": data_path.stat().st_size,
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    data_path.write_text('{"changed": true}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        validate_data_release(manifest_path, data_path)


@pytest.mark.parametrize(
    "coordinates, message",
    [
        ([[0, 0], [1, 0], [1, 1], [0, 1]], "ring is not closed"),
        ([[0, 0], [1, 0], [0, 0], [0, 0]], "fewer than three distinct"),
    ],
)
def test_polygon_validation_rejects_invalid_rings(coordinates, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        validate_polygon_geojson({"type": "Polygon", "coordinates": [coordinates]})


def test_polygon_validation_rejects_duplicate_geometries() -> None:
    geometry = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]],
    }
    payload = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {}, "geometry": geometry},
            {"type": "Feature", "properties": {}, "geometry": geometry},
        ],
    }
    with pytest.raises(ValueError, match="duplicate geometry"):
        validate_polygon_geojson(payload)
