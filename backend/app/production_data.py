"""Read-only operational status for Iteration 2 production geospatial data."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    MonitoredArea,
    OccurrenceRecord,
    OsmImport,
    PlaceOccurrenceWaterwayEvidence,
    ProtectedArea,
    ProtectedAreaDataset,
    Species,
    Trail,
    WaterwayDataset,
    WaterwayEdge,
)
from app.domain.catalogue import load_approved_species

REQUIRED_APPROVED_SPECIES = 32


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def production_data_snapshot(session: Session, *, include_versions: bool = False) -> dict[str, Any]:
    """Return one consistent, non-mutating status snapshot."""
    approved_ids = tuple(record.species_id for record in load_approved_species())
    active_protected_ids = select(ProtectedAreaDataset.id).where(
        ProtectedAreaDataset.active.is_(True)
    )
    active_waterway_ids = select(WaterwayDataset.id).where(WaterwayDataset.active.is_(True))
    row = session.execute(
        select(
            select(func.count(Species.id))
            .where(Species.id.in_(approved_ids))
            .scalar_subquery()
            .label("catalogue"),
            select(func.count(MonitoredArea.id)).scalar_subquery().label("areas"),
            select(func.count(Trail.id)).scalar_subquery().label("trails"),
            select(func.count(OccurrenceRecord.id)).scalar_subquery().label("occurrences"),
            select(func.count(distinct(OccurrenceRecord.species_id)))
            .scalar_subquery()
            .label("occurrence_species"),
            select(func.count(ProtectedArea.id))
            .where(ProtectedArea.dataset_id.in_(active_protected_ids))
            .scalar_subquery()
            .label("protected_areas"),
            select(func.max(ProtectedAreaDataset.version))
            .where(ProtectedAreaDataset.active.is_(True))
            .scalar_subquery()
            .label("protected_version"),
            select(func.count(WaterwayEdge.id))
            .where(WaterwayEdge.dataset_id.in_(active_waterway_ids))
            .scalar_subquery()
            .label("waterway_edges"),
            select(func.max(WaterwayDataset.version))
            .where(WaterwayDataset.active.is_(True))
            .scalar_subquery()
            .label("waterway_version"),
            select(func.count(PlaceOccurrenceWaterwayEvidence.id))
            .scalar_subquery()
            .label("upstream_evidence"),
            select(OsmImport.sha256)
            .order_by(OsmImport.source_date.desc(), OsmImport.created_at.desc())
            .limit(1)
            .scalar_subquery()
            .label("osm_source_sha256"),
            select(
                ProtectedAreaDataset.metadata_json["release"]["source_pbf_sha256"].as_string()
            )
            .where(ProtectedAreaDataset.active.is_(True))
            .order_by(ProtectedAreaDataset.updated_at.desc())
            .limit(1)
            .scalar_subquery()
            .label("protected_source_sha256"),
            select(WaterwayDataset.sha256)
            .where(WaterwayDataset.active.is_(True))
            .order_by(WaterwayDataset.source_timestamp.desc())
            .limit(1)
            .scalar_subquery()
            .label("waterway_source_sha256"),
        )
    ).one()
    catalogue = int(row.catalogue or 0)
    areas = int(row.areas or 0)
    trails = int(row.trails or 0)
    occurrences = int(row.occurrences or 0)
    protected_areas = int(row.protected_areas or 0)
    waterway_edges = int(row.waterway_edges or 0)
    osm_source_sha256 = bytes(row.osm_source_sha256).hex() if row.osm_source_sha256 else None
    protected_source_sha256 = row.protected_source_sha256 or None
    waterway_source_sha256 = (
        bytes(row.waterway_source_sha256).hex() if row.waterway_source_sha256 else None
    )
    source_releases_aligned = bool(
        osm_source_sha256
        and osm_source_sha256 == protected_source_sha256 == waterway_source_sha256
    )
    ready = (
        catalogue == REQUIRED_APPROVED_SPECIES
        and areas + trails > 0
        and occurrences > 0
        and protected_areas > 0
        and row.protected_version is not None
        and waterway_edges > 0
        and row.waterway_version is not None
        and source_releases_aligned
    )
    result: dict[str, Any] = {
        "status": "ok" if ready else "degraded",
        "catalogueSpecies": catalogue,
        "areas": areas,
        "trails": trails,
        "occurrences": occurrences,
        "occurrenceSpecies": int(row.occurrence_species or 0),
        "protectedAreas": protected_areas,
        "protectedDatasetVersion": row.protected_version,
        "waterwayEdges": waterway_edges,
        "waterwayDatasetVersion": row.waterway_version,
        "upstreamEvidence": int(row.upstream_evidence or 0),
        "osmSourceSha256": osm_source_sha256,
        "protectedSourcePbfSha256": protected_source_sha256,
        "waterwaySourcePbfSha256": waterway_source_sha256,
        "sourceReleasesAligned": source_releases_aligned,
        "placeOccurrenceAssociationsAvailable": bool((areas + trails) and occurrences),
    }
    if not include_versions:
        return result

    result["osmImports"] = [
        {
            "source": item.source_name,
            "sourceTimestamp": _iso(item.source_date),
            "importedAt": _iso(item.created_at),
            "areas": item.area_count,
            "trails": item.trail_count,
        }
        for item in session.scalars(select(OsmImport).order_by(OsmImport.created_at)).all()
    ]
    occurrence_versions = session.execute(
        select(
            OccurrenceRecord.processed_data_version,
            func.count(OccurrenceRecord.id),
            func.max(OccurrenceRecord.imported_at),
        )
        .group_by(OccurrenceRecord.processed_data_version)
        .order_by(OccurrenceRecord.processed_data_version)
    ).all()
    result["occurrenceVersions"] = [
        {"version": version, "count": int(count), "importedAt": _iso(imported_at)}
        for version, count, imported_at in occurrence_versions
    ]
    result["protectedDatasets"] = [
        {
            "source": dataset.source,
            "version": dataset.version,
            "updatedAt": _iso(dataset.updated_at),
            "active": dataset.active,
        }
        for dataset in session.scalars(
            select(ProtectedAreaDataset).order_by(ProtectedAreaDataset.updated_at)
        ).all()
    ]
    result["waterwayDatasets"] = [
        {
            "source": dataset.source,
            "version": dataset.version,
            "sourceTimestamp": _iso(dataset.source_timestamp),
            "active": dataset.active,
        }
        for dataset in session.scalars(
            select(WaterwayDataset).order_by(WaterwayDataset.source_timestamp)
        ).all()
    ]
    return result
