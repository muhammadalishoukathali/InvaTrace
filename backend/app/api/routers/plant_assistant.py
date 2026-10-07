"""Ephemeral plant questions using the current scan and reviewed evidence."""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, field_validator

from app.api.schemas import ApiModel
from app.config import Settings, get_settings
from app.core.rate_limit import client_address, rate_limiter
from app.domain.plant_assistant import (
    SAFETY_BOUNDARY,
    SupportState,
    contains_private_details,
    fallback_evidence,
    get_retriever,
    protected_chunks,
    requested_hazard_aspect,
    validate_generated,
)
from app.services.assistant_generation import generate
from app.services.assistant_grounding import validate_grounding, verify_grounding
from app.services.assistant_judge import evaluate, validate_judgement

router = APIRouter(prefix="/api/v1/plant-assistant", tags=["plant-assistant"])


class AskRequest(ApiModel):
    species_id: str | None = Field(default=None, max_length=120)
    classifier_confidence: float = Field(ge=0, le=1, allow_inf_nan=False)
    classifier_outcome: Literal["target", "other_plant", "uncertain"] | None = None
    question: str = Field(min_length=1, max_length=600)
    depth: Literal["standard", "simpler", "detailed"] = "standard"

    @field_validator("question")
    @classmethod
    def nonempty_question(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter a question")
        return value


class Source(ApiModel):
    chunk_id: str
    source_name: str
    source_url: str
    jurisdiction: str
    source_date: str | None = None
    attribution: str | None = None
    source_license: str | None = None
    source_license_url: str | None = None


class AskResponse(ApiModel):
    status: Literal["answer", "fallback", "insufficient_evidence", "unsupported_scan"]
    answerability: Literal["answerable", "insufficient_evidence"] = "insufficient_evidence"
    answer: str
    sources: list[Source] = Field(default_factory=list)
    safety_boundary: str = SAFETY_BOUNDARY
    covered_topics: list[str] = Field(default_factory=list)


def stored_sources(chunks: list[dict]) -> list[Source]:
    return [
        Source(
            chunk_id=c["chunk_id"],
            source_name=s["title"],
            source_url=s["url"],
            jurisdiction=c["jurisdiction"],
            source_date=c.get("source_date"),
            attribution=s.get("attribution"),
            source_license=s.get("license"),
            source_license_url=s.get("license_url"),
        )
        for c in chunks
        for s in c["sources"]
    ]


def unsupported_scan_response() -> AskResponse:
    return AskResponse(
        status="unsupported_scan",
        answer="The scan does not identify one of the supported plant categories with sufficient confidence, so species-specific assistant guidance is unavailable. Try a clearer scan or browse the catalogue.",
    )


@router.post("/ask", response_model=AskResponse)
async def ask(
    body: AskRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> AskResponse:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Pragma"] = "no-cache"
    rate_limiter.check("plant_assistant", client_address(request))
    if (
        body.classifier_outcome in {"other_plant", "uncertain"}
        or body.classifier_confidence < settings.model_acceptance_threshold
    ):
        return unsupported_scan_response()
    retriever = get_retriever()
    species_id = retriever.canonical(body.species_id)
    if not species_id:
        return unsupported_scan_response()
    covered = retriever.covered_topics(species_id)
    if contains_private_details(body.question):
        return AskResponse(
            status="insufficient_evidence",
            answer="Please ask about the plant without personal details, coordinates, passwords or access codes.",
            covered_topics=covered,
        )
    hazard_scope = requested_hazard_aspect(retriever.factual_question(species_id, body.question))
    if hazard_scope:
        hazards = retriever.documented_hazards(species_id, hazard_scope)
        if hazards:
            return AskResponse(
                status="fallback",
                answerability="answerable",
                answer="\n\n".join(c["content"] for c in hazards),
                sources=stored_sources(hazards),
            )
        return AskResponse(
            status="insufficient_evidence",
            answer="The reviewed sources do not document this hazard. This does not establish that the plant is safe to touch, eat or handle.",
            sources=stored_sources(retriever.search(species_id, body.question)),
            covered_topics=covered,
        )
    candidates = retriever.search(species_id, body.question)
    support = retriever.classify(species_id, body.question, candidates)
    evidence = support.evidence

    def insufficient() -> AskResponse:
        return AskResponse(
            status="insufficient_evidence",
            answer="The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.",
            sources=stored_sources(candidates),
            covered_topics=covered,
        )

    if support.state == SupportState.HARD_BLOCK:
        return insufficient()
    species = retriever.species[species_id].scientific_name
    loop = asyncio.get_running_loop()
    deadline = loop.time() + settings.assistant_request_timeout_seconds
    if support.state == SupportState.NEEDS_SEMANTIC_REVIEW:
        try:
            judgement = await asyncio.wait_for(
                evaluate(body.question, species, evidence, settings),
                timeout=min(settings.assistant_judge_timeout_seconds, deadline - loop.time()),
            )
        except TimeoutError:
            return insufficient()
        evidence = validate_judgement(judgement, body.question, species, evidence)
        if not evidence:
            return insufficient()
    def fallback() -> AskResponse:
        answer, used = fallback_evidence(retriever, species_id, evidence, body.depth)
        return AskResponse(
            status="fallback",
            answerability="answerable",
            answer=answer,
            sources=stored_sources(used),
        )

    if len(protected_chunks(evidence)) == len(evidence):
        return fallback()
    # A judge failure never reaches this branch. Generation failure retains
    # only the support-approved set, rather than every related candidate.
    try:
        remaining = max(0, deadline - loop.time())
        generation_settings = settings.model_copy(
            update={
                "assistant_generation_timeout_seconds": min(
                    settings.assistant_generation_timeout_seconds, remaining
                )
            }
        )
        payload = await asyncio.wait_for(
            generate(body.question, species, evidence, body.depth, generation_settings),
            timeout=remaining,
        )
    except TimeoutError:
        payload = None
    validated = validate_generated(payload, evidence, species)
    if validated and isinstance(payload, dict) and "sentences" in payload:
        protected_ids = {c["chunk_id"] for c in protected_chunks(evidence)}
        botanical = [c for c in evidence if c["chunk_id"] not in protected_ids]
        remaining = max(0, deadline - loop.time())
        verdict = None
        if remaining > 0:
            grounding_settings = settings.model_copy(
                update={
                    "assistant_judge_timeout_seconds": min(
                        settings.assistant_judge_timeout_seconds, remaining
                    )
                }
            )
            try:
                verdict = await asyncio.wait_for(
                    verify_grounding(
                        species,
                        payload["sentences"],
                        botanical,
                        payload["used_chunk_ids"],
                        grounding_settings,
                    ),
                    timeout=min(settings.assistant_judge_timeout_seconds, remaining),
                )
            except TimeoutError:
                verdict = None
        if validate_grounding(
            verdict, species, payload["sentences"], botanical, payload["used_chunk_ids"]
        ):
            answer, used = validated
            return AskResponse(
                status="answer",
                answerability="answerable",
                answer=answer,
                sources=stored_sources(used),
            )
    return fallback()
