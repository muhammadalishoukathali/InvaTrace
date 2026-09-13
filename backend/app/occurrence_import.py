"""Validated import for historical Malaysian occurrence records.

The importer is deliberately append-only and fail-closed: records outside the
closed 32-species catalogue, outside Malaysia, imprecise, absent, or duplicated
never reach the association table.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import OccurrenceRecord
from app.domain.catalogue import load_approved_species


@dataclass(frozen=True)
class OccurrenceImportResult:
    accepted: int
    excluded: int
    exclusion_reasons: dict[str, int]
    processed_data_version: str


def _value(record: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in record:
            return record[name]
    return None


def _approved_species_id(record: dict[str, Any]) -> str | None:
    requested_id = str(_value(record, "speciesId", "species_id") or "").strip().lower()
    requested_name = (
        str(_value(record, "scientificName", "scientific_name", "scientificNameAccepted") or "")
        .strip()
        .casefold()
    )
    for approved in load_approved_species():
        names = {approved.scientific_name.casefold()}
        if approved.accepted_scientific_name:
            names.add(approved.accepted_scientific_name.casefold())
        if requested_id.replace("_", "-") == approved.species_id or requested_name in names:
            return approved.species_id
    return None


def _decimal(value: Any) -> Decimal | None:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def _point_on_segment(
    longitude: float,
    latitude: float,
    left: list[float],
    right: list[float],
) -> bool:
    cross = (longitude - left[0]) * (right[1] - left[1]) - (
        latitude - left[1]
    ) * (right[0] - left[0])
    if abs(cross) > 1e-12:
        return False
    return (
        min(left[0], right[0]) - 1e-12 <= longitude <= max(left[0], right[0]) + 1e-12
        and min(left[1], right[1]) - 1e-12
        <= latitude
        <= max(left[1], right[1]) + 1e-12
    )


def _point_in_ring(longitude: float, latitude: float, ring: list[list[float]]) -> bool:
    inside = False
    for index, left in enumerate(ring):
        right = ring[(index + 1) % len(ring)]
        if _point_on_segment(longitude, latitude, left, right):
            return True
        if (left[1] > latitude) != (right[1] > latitude):
            intersection = (right[0] - left[0]) * (latitude - left[1]) / (
                right[1] - left[1]
            ) + left[0]
            if longitude < intersection:
                inside = not inside
    return inside


def _country_polygons(source_path: Path) -> list[list[list[list[float]]]]:
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    if payload.get("type") == "FeatureCollection":
        geometries = [
            feature.get("geometry")
            for feature in payload.get("features", [])
            if isinstance(feature, dict)
        ]
    elif payload.get("type") == "Feature":
        geometries = [payload.get("geometry")]
    else:
        geometries = [payload]
    polygons: list[list[list[list[float]]]] = []
    for geometry in geometries:
        if not isinstance(geometry, dict):
            continue
        if geometry.get("type") == "Polygon":
            coordinates = geometry.get("coordinates")
            if isinstance(coordinates, list):
                polygons.append(coordinates)
        elif geometry.get("type") == "MultiPolygon":
            coordinates = geometry.get("coordinates")
            if isinstance(coordinates, list):
                polygons.extend(coordinates)
    if not polygons or any(not polygon or len(polygon[0]) < 4 for polygon in polygons):
        raise ValueError("country boundary must contain valid Polygon or MultiPolygon geometry")
    return polygons


def _inside_country_boundary(
    longitude: float,
    latitude: float,
    polygons: list[list[list[list[float]]]],
) -> bool:
    for polygon in polygons:
        if not _point_in_ring(longitude, latitude, polygon[0]):
            continue
        if any(_point_in_ring(longitude, latitude, hole) for hole in polygon[1:]):
            continue
        return True
    return False


def import_occurrence_json(
    session: Session,
    *,
    source_path: Path,
    source: str,
    processed_data_version: str,
    country_boundary_path: Path,
) -> OccurrenceImportResult:
    """Import a JSON array (or ``{"records": [...]}``) after AC 5.1.2 validation."""
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    records = payload.get("records") if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        raise ValueError("occurrence JSON must be an array or an object with a records array")
    source = source.strip()
    processed_data_version = processed_data_version.strip()
    if not source or not processed_data_version:
        raise ValueError("source and processed_data_version are required")
    country_polygons = _country_polygons(country_boundary_path)

    known_ids = set(
        session.scalars(
            select(OccurrenceRecord.source_occurrence_id).where(OccurrenceRecord.source == source)
        ).all()
    )
    seen_ids: set[str] = set()
    reasons: Counter[str] = Counter()
    accepted = 0
    now = datetime.now(UTC)
    for raw in records:
        if not isinstance(raw, dict):
            reasons["invalid_record"] += 1
            continue
        occurrence_id = str(
            _value(raw, "sourceOccurrenceId", "source_occurrence_id", "occurrenceID") or ""
        ).strip()
        if not occurrence_id:
            reasons["missing_source_occurrence_id"] += 1
            continue
        if occurrence_id in seen_ids or occurrence_id in known_ids:
            reasons["duplicate_source_occurrence_id"] += 1
            continue
        seen_ids.add(occurrence_id)
        if str(_value(raw, "countryCode", "country_code") or "").strip().upper() != "MY":
            reasons["country_not_malaysia"] += 1
            continue
        if str(_value(raw, "occurrenceStatus", "occurrence_status") or "").strip() != "Present":
            reasons["occurrence_not_present"] += 1
            continue
        latitude = _decimal(_value(raw, "decimalLatitude", "latitude"))
        longitude = _decimal(_value(raw, "decimalLongitude", "longitude"))
        if (
            latitude is None
            or longitude is None
            or not (
                Decimal("0.8") <= latitude <= Decimal("7.5")
                and Decimal("99.3") <= longitude <= Decimal("119.5")
            )
        ):
            reasons["invalid_or_non_malaysian_coordinates"] += 1
            continue
        if not _inside_country_boundary(float(longitude), float(latitude), country_polygons):
            reasons["country_coordinate_mismatch"] += 1
            continue
        uncertainty_raw = _value(raw, "coordinateUncertaintyInMeters", "coordinate_uncertainty_m")
        try:
            uncertainty = int(uncertainty_raw)
        except (TypeError, ValueError):
            reasons["missing_coordinate_uncertainty"] += 1
            continue
        if uncertainty < 0 or uncertainty > 1000:
            reasons["coordinate_uncertainty_above_1000m"] += 1
            continue
        species_id = _approved_species_id(raw)
        if species_id is None:
            reasons["species_not_approved"] += 1
            continue
        observed_year_raw = _value(raw, "year", "observedYear", "observed_year")
        try:
            observed_year = int(observed_year_raw) if observed_year_raw is not None else None
        except (TypeError, ValueError):
            observed_year = None

        session.add(
            OccurrenceRecord(
                source=source,
                source_occurrence_id=occurrence_id,
                species_id=species_id,
                latitude=latitude,
                longitude=longitude,
                country_code="MY",
                occurrence_status="Present",
                coordinate_uncertainty_m=uncertainty,
                observed_year=observed_year,
                processed_data_version=processed_data_version,
                imported_at=now,
            )
        )
        accepted += 1
    session.commit()
    return OccurrenceImportResult(
        accepted=accepted,
        excluded=len(records) - accepted,
        exclusion_reasons=dict(sorted(reasons.items())),
        processed_data_version=processed_data_version,
    )
