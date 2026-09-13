"""Iteration 2 public catalogue backed by the closed 32-species allowlist."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query

from app.api.schemas import ApiModel
from app.core.errors import ApiProblem
from app.domain.catalogue import (
    approved_catalogue_image,
    approved_species_record,
    load_approved_dataset,
    load_approved_species,
    load_guidance_dataset,
)

router = APIRouter(prefix="/api/v1/catalogue", tags=["catalogue"])

NO_SEVERITY = "Formal severity assessment not available"
NO_SAFE_ACTION = "No beginner-safe active action is provided"


class CatalogueImage(ApiModel):
    url: str
    creator: str
    license: str
    source_title: str
    source_url_or_identifier: str
    reviewed_at: date


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


def _guidance_by_species_id() -> dict[str, dict]:
    return {
        item["plant_id"].replace("_", "-"): item
        for item in load_guidance_dataset().get("plants", [])
    }


def _image_for(guidance: dict | None) -> CatalogueImage | None:
    if not guidance:
        return None
    url = guidance.get("reference_image")
    if not isinstance(url, str):
        return None
    image = approved_catalogue_image(url)
    if image is None:
        return None
    return CatalogueImage(
        url=image.url,
        creator=image.creator,
        license=image.licence,
        source_title=image.source_title,
        source_url_or_identifier=image.source_url_or_identifier,
        reviewed_at=image.reviewed_at,
    )


def _summary(record, guidance: dict | None) -> CatalogueSpeciesSummary:
    return CatalogueSpeciesSummary(
        species_id=record.species_id,
        scientific_name=record.scientific_name,
        common_names=list(record.common_names),
        malaysia_status="Present",
        image=_image_for(guidance),
    )


@router.get("", response_model=CatalogueListResponse)
def list_catalogue(
    q: str | None = Query(default=None, max_length=120),
) -> CatalogueListResponse:
    dataset = load_approved_dataset()
    guidance = _guidance_by_species_id()
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
        items=[_summary(record, guidance.get(record.species_id)) for record in records],
    )


@router.get("/{species_id}", response_model=CatalogueSpeciesDetail)
def catalogue_detail(species_id: str) -> CatalogueSpeciesDetail:
    record = approved_species_record(species_id)
    if record is None:
        raise ApiProblem(404, "catalogue_species_not_found", "Not found")
    dataset = load_approved_dataset()
    guidance = _guidance_by_species_id().get(record.species_id)
    evidence_sources = {source["source_id"]: source for source in dataset.get("sources", [])}
    sources = [
        CatalogueSource.model_validate(evidence_sources[source_id])
        for source_id in record.evidence_source_ids
        if source_id in evidence_sources
    ]
    safe_steps: list[str] = []
    if guidance:
        protected_path = (guidance.get("actions") or {}).get("protected_or_permission_unknown")
        if protected_path:
            safe_steps = [item["text"] for item in protected_path.get("steps", [])]
    identifying = (
        guidance.get("general_information")
        if guidance
        else "Identification characteristics have not yet been reviewed for this catalogue entry."
    )
    return CatalogueSpeciesDetail(
        **_summary(record, guidance).model_dump(),
        accepted_scientific_name=record.accepted_scientific_name,
        identifying_characteristics=identifying,
        habitats=list(record.habitats),
        impacts=(
            "Reviewed impact detail is not yet available in InvaTrace."
            if not guidance
            else "See the cited plant guidance sources for reviewed impact and spread context."
        ),
        safe_response_guidance=safe_steps or [NO_SAFE_ACTION],
        formal_severity_assessment=NO_SEVERITY,
        evidence_summary=record.evidence_summary,
        sources=sources,
        last_reviewed=record.status_reviewed_at,
        catalogue_version=dataset["catalogue_version"],
    )
