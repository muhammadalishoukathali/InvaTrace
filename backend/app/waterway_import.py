"""Fail-closed import of place-specific upstream waterway evidence.

The occurrence importer intentionally does not infer hydrological relationships.
This module accepts only output produced by the directed OpenStreetMap waterway
preprocessing pipeline and links one existing occurrence to one supported place.
"""

from __future__ import annotations

import json
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routers.location import _classify_area
from app.data_release import validate_data_release
from app.db.models import (
    MonitoredArea,
    OccurrenceRecord,
    PlaceOccurrenceWaterwayEvidence,
    Trail,
)
from app.domain.catalogue import approved_species_record

OSM_DIRECTION_SOURCE = "OpenStreetMap directed waterway preprocessing"
SUPPORTED_PLACE_TYPES = {"park", "forest", "wood", "trail"}
MAX_SNAP_DISTANCE_M = Decimal("50")
EVIDENCE_SCHEMA_VERSION = "invatrace.osm-waterway-evidence.v1"


@dataclass(frozen=True)
class WaterwayImportResult:
    accepted: int
    excluded: int
    exclusion_reasons: dict[str, int]
    data_version: str


def _value(record: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in record:
            return record[name]
    return None


def _decimal(value: Any) -> Decimal | None:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def _place_matches_type(session: Session, place_id: uuid.UUID, place_type: str) -> bool:
    if place_type == "trail":
        place = session.get(Trail, place_id)
        metadata = place.metadata_json if place is not None else None
        return (
            place is not None
            and (metadata or {}).get("geometry_status", "available") == "available"
        )
    place = session.get(MonitoredArea, place_id)
    if place is None:
        return False
    metadata = place.metadata_json or {}
    return (
        metadata.get("geometry_status", "available") == "available"
        and _classify_area(place.name, metadata) == place_type
    )


def import_waterway_evidence_json(
    session: Session,
    *,
    source_path: Path,
    data_version: str,
    release_manifest_path: Path | None = None,
) -> WaterwayImportResult:
    """Import validated output from the directed-waterway preprocessing stage."""
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("waterway evidence must use the auditable v1 object envelope")
    if payload.get("schemaVersion") != EVIDENCE_SCHEMA_VERSION:
        raise ValueError(f"waterway evidence must use {EVIDENCE_SCHEMA_VERSION}")
    if payload.get("dataVersion") != data_version:
        raise ValueError("waterway evidence dataVersion does not match the requested version")
    release = (
        validate_data_release(
            release_manifest_path,
            source_path,
            expected_dataset_id="osm-malaysia-waterway-evidence",
        )
        if release_manifest_path is not None
        else None
    )
    if release is not None and (
        release.source != payload.get("source")
        or release.source_url != payload.get("sourceUrl")
        or release.upstream_version != data_version
        or release.licence != payload.get("licence")
        or release.licence_url != payload.get("licenceUrl")
    ):
        raise ValueError("waterway evidence envelope does not match its release manifest")
    source_sha256 = payload.get("sourceSha256")
    if (
        not isinstance(source_sha256, str)
        or len(source_sha256) != 64
        or any(character not in "0123456789abcdef" for character in source_sha256)
    ):
        raise ValueError("waterway evidence sourceSha256 must be a lowercase SHA-256 digest")
    required_provenance = ("source", "sourceUrl", "sourceTimestamp", "licence", "licenceUrl")
    if any(
        not isinstance(payload.get(field), str) or not payload[field].strip()
        for field in required_provenance
    ):
        raise ValueError("waterway evidence provenance is incomplete")
    try:
        source_timestamp = datetime.fromisoformat(payload["sourceTimestamp"].replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("waterway evidence sourceTimestamp is invalid") from exc
    if source_timestamp.tzinfo is None:
        raise ValueError("waterway evidence sourceTimestamp must include a timezone")
    records = payload.get("records")
    if not isinstance(records, list):
        raise ValueError("waterway evidence object must contain a records array")
    data_version = data_version.strip()
    if not data_version:
        raise ValueError("data_version is required")

    known_keys = set(
        session.execute(
            select(
                PlaceOccurrenceWaterwayEvidence.place_type,
                PlaceOccurrenceWaterwayEvidence.place_id,
                PlaceOccurrenceWaterwayEvidence.occurrence_id,
                PlaceOccurrenceWaterwayEvidence.waterway_network_id,
            )
        ).all()
    )
    seen_keys: set[tuple[str, uuid.UUID, uuid.UUID, str]] = set()
    occurrence_cache: dict[tuple[str, str], OccurrenceRecord | None] = {}
    reasons: Counter[str] = Counter()
    accepted = 0
    now = datetime.now(UTC)

    for raw in records:
        if not isinstance(raw, dict):
            reasons["invalid_record"] += 1
            continue
        occurrence_source = str(
            _value(raw, "occurrenceSource", "occurrence_source", "source") or ""
        ).strip()
        source_occurrence_id = str(
            _value(raw, "sourceOccurrenceId", "source_occurrence_id", "occurrenceID") or ""
        ).strip()
        if not occurrence_source or not source_occurrence_id:
            reasons["missing_occurrence_reference"] += 1
            continue
        occurrence_key = (occurrence_source, source_occurrence_id)
        if occurrence_key not in occurrence_cache:
            occurrence_cache[occurrence_key] = session.scalar(
                select(OccurrenceRecord).where(
                    OccurrenceRecord.source == occurrence_source,
                    OccurrenceRecord.source_occurrence_id == source_occurrence_id,
                )
            )
        occurrence = occurrence_cache[occurrence_key]
        if occurrence is None:
            reasons["occurrence_not_found"] += 1
            continue
        approved = approved_species_record(occurrence.species_id)
        if approved is None:
            reasons["species_not_approved"] += 1
            continue
        if not approved.water_dispersed:
            reasons["species_not_water_dispersed"] += 1
            continue

        place_type = str(_value(raw, "placeType", "place_type") or "").strip().lower()
        if place_type not in SUPPORTED_PLACE_TYPES:
            reasons["unsupported_place_type"] += 1
            continue
        try:
            place_id = uuid.UUID(str(_value(raw, "placeId", "place_id") or ""))
        except ValueError:
            reasons["invalid_place_id"] += 1
            continue
        if not _place_matches_type(session, place_id, place_type):
            reasons["place_not_found_or_type_mismatch"] += 1
            continue

        network_id = str(_value(raw, "waterwayNetworkId", "waterway_network_id") or "").strip()
        if not network_id:
            reasons["missing_waterway_network_id"] += 1
            continue
        direction_source = str(_value(raw, "directionSource", "direction_source") or "").strip()
        if direction_source != OSM_DIRECTION_SOURCE:
            reasons["untrusted_direction_source"] += 1
            continue
        upstream_distance = _decimal(_value(raw, "upstreamDistanceM", "upstream_distance_m"))
        if (
            upstream_distance is None
            or upstream_distance < Decimal("0")
            or upstream_distance > Decimal("5000")
        ):
            reasons["upstream_distance_out_of_range"] += 1
            continue
        occurrence_snap_distance = _decimal(
            _value(raw, "occurrenceSnapDistanceM", "occurrence_snap_distance_m")
        )
        place_snap_distance = _decimal(_value(raw, "placeSnapDistanceM", "place_snap_distance_m"))
        if (
            occurrence_snap_distance is None
            or place_snap_distance is None
            or occurrence_snap_distance < 0
            or place_snap_distance < 0
            or occurrence_snap_distance > MAX_SNAP_DISTANCE_M
            or place_snap_distance > MAX_SNAP_DISTANCE_M
        ):
            reasons["snap_distance_out_of_range"] += 1
            continue
        try:
            occurrence_osm_way_id = int(_value(raw, "occurrenceOsmWayId", "occurrence_osm_way_id"))
            place_osm_way_id = int(_value(raw, "placeOsmWayId", "place_osm_way_id"))
        except (TypeError, ValueError):
            reasons["missing_or_invalid_osm_way_id"] += 1
            continue
        if occurrence_osm_way_id <= 0 or place_osm_way_id <= 0:
            reasons["missing_or_invalid_osm_way_id"] += 1
            continue

        key = (place_type, place_id, occurrence.id, network_id)
        if key in known_keys or key in seen_keys:
            reasons["duplicate_place_occurrence_waterway"] += 1
            continue
        seen_keys.add(key)
        session.add(
            PlaceOccurrenceWaterwayEvidence(
                place_type=place_type,
                place_id=place_id,
                occurrence_id=occurrence.id,
                waterway_network_id=network_id,
                upstream_distance_m=upstream_distance,
                occurrence_snap_distance_m=occurrence_snap_distance,
                place_snap_distance_m=place_snap_distance,
                occurrence_osm_way_id=occurrence_osm_way_id,
                place_osm_way_id=place_osm_way_id,
                direction_source=OSM_DIRECTION_SOURCE,
                data_version=data_version,
                imported_at=now,
            )
        )
        accepted += 1

    session.commit()
    return WaterwayImportResult(
        accepted=accepted,
        excluded=len(records) - accepted,
        exclusion_reasons=dict(sorted(reasons.items())),
        data_version=data_version,
    )
