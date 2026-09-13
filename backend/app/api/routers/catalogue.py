"""Iteration 2 public catalogue backed by the closed 32-species allowlist."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query

from app.api.schemas import ApiModel
from app.core.errors import ApiProblem
from app.domain.catalogue import (
    approved_catalogue_image_for_species,
    approved_species_record,
    catalogue_detail_record,
    load_approved_dataset,
    load_approved_species,
    load_catalogue_details_dataset,
)

router = APIRouter(prefix="/api/v1/catalogue", tags=["catalogue"])

NO_SEVERITY = "Formal severity assessment not available"
NO_SAFE_ACTION = "No beginner-safe active action is provided"


class CatalogueImage(ApiModel):
    url: str
    creator: str
    license: str
    license_url: str
    source_title: str
    source_url_or_identifier: str
    reviewed_at: date
    attribution_text: str


class CatalogueSpeciesSummary(ApiModel):
    species_id: str
    scientific_name: str
    common_names: list[str]
    malaysia_status: str
    image: CatalogueImage | None


class CatalogueListResponse(ApiModel):
    catalogue_version: str
    reviewed_at: date
    items: list[CatalogueSpeciesSummary]


class CatalogueSource(ApiModel):
    source_id: str
    title: str
    publisher: str
    url: str
    accessed: date
    reuse_status: str | None = None


class CatalogueSpeciesDetail(CatalogueSpeciesSummary):
    accepted_scientific_name: str | None
    identifying_characteristics: str
    habitats: list[str]
    impacts: str
    safe_response_guidance: list[str]
    formal_severity_assessment: str
    evidence_summary: str
    sources: list[CatalogueSource]
    last_reviewed: date
    catalogue_version: str


def _image_for(species_id: str) -> CatalogueImage | None:
    image = approved_catalogue_image_for_species(species_id)
    if image is None:
        return None
    return CatalogueImage(
        url=image.url,
        creator=image.creator,
        license=image.licence,
        license_url=image.licence_url,
        source_title=image.source_title,
        source_url_or_identifier=image.source_url_or_identifier,
        reviewed_at=image.reviewed_at,
        attribution_text=image.attribution_text,
    )


def _summary(record) -> CatalogueSpeciesSummary:
    return CatalogueSpeciesSummary(
        species_id=record.species_id,
        scientific_name=record.scientific_name,
        common_names=list(record.common_names),
        malaysia_status="Present",
        image=_image_for(record.species_id),
    )


@router.get("", response_model=CatalogueListResponse)
def list_catalogue(
    q: str | None = Query(default=None, max_length=120),
) -> CatalogueListResponse:
    dataset = load_approved_dataset()
    query = (q or "").strip().casefold()
    records = load_approved_species()
    if query:
        records = tuple(
            record
            for record in records
            if query in record.scientific_name.casefold()
            or any(query in name.casefold() for name in record.common_names)
        )
    return CatalogueListResponse(
        catalogue_version=dataset["catalogue_version"],
        reviewed_at=date.fromisoformat(dataset["reviewed_at"]),
        items=[_summary(record) for record in records],
    )


@router.get("/{species_id}", response_model=CatalogueSpeciesDetail)
def catalogue_detail(species_id: str) -> CatalogueSpeciesDetail:
    record = approved_species_record(species_id)
    if record is None:
        raise ApiProblem(404, "catalogue_species_not_found", "Not found")
    dataset = load_approved_dataset()
    detail = catalogue_detail_record(record.species_id)
    if detail is None:
        raise ApiProblem(503, "catalogue_detail_unavailable", "Catalogue detail unavailable")
    evidence_sources = {source["source_id"]: source for source in dataset.get("sources", [])}
    detail_sources = {
        source["source_id"]: source
        for source in load_catalogue_details_dataset().get("sources", [])
    }
    cited_ids = tuple(dict.fromkeys((*record.evidence_source_ids, *detail.source_ids)))
    sources = []
    for source_id in cited_ids:
        raw_source = evidence_sources.get(source_id) or detail_sources.get(source_id)
        if raw_source:
            sources.append(CatalogueSource.model_validate(raw_source))
    return CatalogueSpeciesDetail(
        **_summary(record).model_dump(),
        accepted_scientific_name=record.accepted_scientific_name,
        identifying_characteristics=detail.identifying_characteristics,
        habitats=[detail.typical_habitat],
        impacts=detail.documented_impacts,
        safe_response_guidance=list(detail.safe_response_guidance) or [NO_SAFE_ACTION],
        formal_severity_assessment=NO_SEVERITY,
        evidence_summary=record.evidence_summary,
        sources=sources,
        last_reviewed=detail.reviewed_at,
        catalogue_version=dataset["catalogue_version"],
    )
