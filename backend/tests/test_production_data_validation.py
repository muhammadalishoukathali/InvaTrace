"""Regression checks for auditable, fail-closed production GIS inputs."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from app.data_release import validate_data_release
from app.geojson_validation import country_polygons, point_in_country, validate_polygon_geojson

REPO_ROOT = Path(__file__).resolve().parents[2]
BOUNDARY_ROOT = REPO_ROOT / "data" / "production" / "malaysia-boundary"
OCCURRENCE_ROOT = REPO_ROOT / "data" / "production" / "gbif-occurrences"


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
