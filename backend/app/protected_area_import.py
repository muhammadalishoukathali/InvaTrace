"""Import an auditable GeoJSON protected-area boundary release."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from geoalchemy2 import Geography
from sqlalchemy import cast, func, select, update
from sqlalchemy.orm import Session

from app.db.models import ProtectedArea, ProtectedAreaDataset


@dataclass(frozen=True)
class ProtectedAreaImportResult:
    dataset_id: str
    feature_count: int
    source: str
    version: str
    already_present: bool


def import_protected_area_geojson(
    session: Session,
    *,
    source_path: Path,
    source: str,
    version: str,
    updated_at: datetime,
    coverage_note: str,
    coverage_path: Path,
) -> ProtectedAreaImportResult:
    source = source.strip()
    version = version.strip()
    coverage_note = coverage_note.strip()
    if not source or not version or not coverage_note:
        raise ValueError("source, version and coverage_note are required")
    existing = session.scalar(
        select(ProtectedAreaDataset).where(
            ProtectedAreaDataset.source == source,
            ProtectedAreaDataset.version == version,
        )
    )
    if existing is not None:
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

    session.execute(update(ProtectedAreaDataset).values(active=False))
    dataset = ProtectedAreaDataset(
        source=source,
        version=version,
        updated_at=updated_at,
        coverage_note=coverage_note,
        coverage_geometry=cast(
            func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(coverage_geometry)), 4326),
            Geography("MULTIPOLYGON", srid=4326),
        ),
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
                    func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(geometry)), 4326),
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
