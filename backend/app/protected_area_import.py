"""Import an auditable GeoJSON protected-area boundary release."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from geoalchemy2 import Geography
from sqlalchemy import cast, func, select, update
from sqlalchemy.orm import Session

from app.data_release import validate_data_release
from app.db.models import ProtectedArea, ProtectedAreaDataset
from app.geojson_validation import validate_polygon_geojson


@dataclass(frozen=True)
class ProtectedAreaImportResult:
    dataset_id: str
    feature_count: int
    source: str
    version: str
    already_present: bool


def _postgis_geometry(
    geometry: dict,
):
    return func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(geometry)), 4326)


def _require_postgis_validity(session: Session, geometry: dict, label: str) -> None:
    expression = _postgis_geometry(geometry)
    if session.scalar(select(func.ST_IsValid(expression))) is not True:
        reason = session.scalar(select(func.ST_IsValidReason(expression)))
        raise ValueError(f"{label} has invalid polygon topology: {reason or 'unknown reason'}")


def import_protected_area_geojson(
    session: Session,
    *,
    source_path: Path,
    source: str,
    version: str,
    updated_at: datetime,
    coverage_note: str,
    coverage_path: Path,
    release_manifest_path: Path | None = None,
    coverage_release_manifest_path: Path | None = None,
) -> ProtectedAreaImportResult:
    source = source.strip()
    version = version.strip()
    coverage_note = coverage_note.strip()
    if not source or not version or not coverage_note:
        raise ValueError("source, version and coverage_note are required")
    release = (
        validate_data_release(release_manifest_path, source_path)
        if release_manifest_path is not None
        else None
    )
    coverage_release = (
        validate_data_release(coverage_release_manifest_path, coverage_path)
        if coverage_release_manifest_path is not None
        else None
    )
    existing = session.scalar(
        select(ProtectedAreaDataset).where(
            ProtectedAreaDataset.source == source,
            ProtectedAreaDataset.version == version,
        )
    )
    if existing is not None:
        stored_release = (existing.metadata_json or {}).get("release") or {}
        stored_coverage_release = (existing.metadata_json or {}).get("coverage_release") or {}
        if release is not None and stored_release.get("sha256") != release.sha256:
            raise ValueError("existing protected-area version has different source bytes")
        if (
            coverage_release is not None
            and stored_coverage_release.get("sha256") != coverage_release.sha256
        ):
            raise ValueError("existing protected-area version has different coverage bytes")
        session.execute(update(ProtectedAreaDataset).values(active=False))
        existing.active = True
        session.commit()
        count = session.scalar(
            select(func.count())
            .select_from(ProtectedArea)
            .where(ProtectedArea.dataset_id == existing.id)
        )
        return ProtectedAreaImportResult(
            dataset_id=str(existing.id),
            feature_count=int(count or 0),
            source=source,
            version=version,
            already_present=True,
        )

    payload = json.loads(source_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
        raise ValueError("protected-area input must be a GeoJSON FeatureCollection")
    boundary_validation = validate_polygon_geojson(payload)
    features = payload.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("protected-area input must contain at least one feature")
    prepared: list[tuple[str, str, dict]] = []
    seen_ids: set[str] = set()
    for index, feature in enumerate(features):
        if not isinstance(feature, dict):
            raise ValueError(f"feature {index} is not an object")
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") not in {
            "Polygon",
            "MultiPolygon",
        }:
            raise ValueError(f"feature {index} must have Polygon or MultiPolygon geometry")
        if geometry["type"] == "Polygon":
            geometry = {"type": "MultiPolygon", "coordinates": [geometry.get("coordinates")]}
        properties = (
            feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        )
        source_id = str(feature.get("id") or properties.get("id") or "").strip()
        name = str(properties.get("name") or "").strip()
        if not source_id or not name:
            raise ValueError(f"feature {index} requires a stable id and name")
        if source_id in seen_ids:
            raise ValueError(f"duplicate protected-area feature id: {source_id}")
        seen_ids.add(source_id)
        prepared.append((source_id, name, geometry))

    coverage_payload = json.loads(coverage_path.read_text(encoding="utf-8"))
    coverage_validation = validate_polygon_geojson(coverage_payload)
    if coverage_payload.get("type") == "Feature":
        coverage_geometry = coverage_payload.get("geometry")
    else:
        coverage_geometry = coverage_payload
    if not isinstance(coverage_geometry, dict) or coverage_geometry.get("type") not in {
        "Polygon",
        "MultiPolygon",
    }:
        raise ValueError("coverage GeoJSON must be a Polygon, MultiPolygon, or Feature")
    if coverage_geometry["type"] == "Polygon":
        coverage_geometry = {
            "type": "MultiPolygon",
            "coordinates": [coverage_geometry.get("coordinates")],
        }

    _require_postgis_validity(session, coverage_geometry, "coverage geometry")
    coverage_expression = _postgis_geometry(coverage_geometry)
    for source_id, _name, geometry in prepared:
        _require_postgis_validity(session, geometry, f"protected-area feature {source_id}")
        if (
            session.scalar(
                select(func.ST_CoveredBy(_postgis_geometry(geometry), coverage_expression))
            )
            is not True
        ):
            raise ValueError(
                f"protected-area feature {source_id} is not fully contained by coverage geometry"
            )

    session.execute(update(ProtectedAreaDataset).values(active=False))
    dataset = ProtectedAreaDataset(
        source=source,
        version=version,
        updated_at=updated_at,
        coverage_note=coverage_note,
        coverage_geometry=cast(
            coverage_expression,
            Geography("MULTIPOLYGON", srid=4326),
        ),
        metadata_json={
            "release": release.metadata if release is not None else {},
            "coverage_release": (coverage_release.metadata if coverage_release is not None else {}),
            "validation": {
                "boundary_geometry_count": boundary_validation.geometry_count,
                "boundary_polygon_count": boundary_validation.polygon_count,
                "boundary_ring_count": boundary_validation.ring_count,
                "boundary_coordinate_count": boundary_validation.coordinate_count,
                "boundary_bounds": list(boundary_validation.bounds),
                "coverage_geometry_count": coverage_validation.geometry_count,
                "coverage_polygon_count": coverage_validation.polygon_count,
                "coverage_ring_count": coverage_validation.ring_count,
                "coverage_coordinate_count": coverage_validation.coordinate_count,
                "coverage_bounds": list(coverage_validation.bounds),
            },
        },
        active=True,
    )
    session.add(dataset)
    session.flush()
    for source_id, name, geometry in prepared:
        session.add(
            ProtectedArea(
                dataset_id=dataset.id,
                source_feature_id=source_id,
                name=name,
                geometry=cast(
                    _postgis_geometry(geometry),
                    Geography("MULTIPOLYGON", srid=4326),
                ),
            )
        )
    session.commit()
    return ProtectedAreaImportResult(
        dataset_id=str(dataset.id),
        feature_count=len(prepared),
        source=source,
        version=version,
        already_present=False,
    )
