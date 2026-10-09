"""Ephemeral plant questions using the current scan and reviewed evidence."""

from __future__ import annotations

import asyncio
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import ApiModel
from app.config import Settings, get_settings
from app.core.rate_limit import client_address, rate_limiter
from app.db.base import get_session
from app.db.models import Sighting, Species
from app.domain.assistant_general_knowledge import eligible_general_question, explicit_evidence_gap
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
from app.services.assistant_general_knowledge import generate_general
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
    allow_general_knowledge: bool = False

    @field_validator("question")
    @classmethod
    def nonempty_question(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter a question")
        return value


class MapAskRequest(ApiModel):
    # Only a genuine public sighting is accepted. No client species or scan fields.
    sighting_id: uuid.UUID
    question: str = Field(min_length=1, max_length=600)
    depth: Literal["standard", "simpler", "detailed"] = "standard"
    allow_general_knowledge: bool = False

    @field_validator("question")
    @classmethod
    def nonempty_question(cls, value: str) -> str:
        return AskRequest.nonempty_question(value)


class GuideAskRequest(ApiModel):
    # A public catalogue reference, never a verified observation or scan.
    species_id: str = Field(min_length=1, max_length=120)
    question: str = Field(min_length=1, max_length=600)
    depth: Literal["standard", "simpler", "detailed"] = "standard"
    allow_general_knowledge: bool = False

    @field_validator("question")
    @classmethod
    def nonempty_question(cls, value: str) -> str:
        return AskRequest.nonempty_question(value)


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
    answer_mode: Literal["grounded", "general_knowledge", "fallback"] = "fallback"


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
    return await answer_for_species(
        species_id, body.question, body.depth, body.allow_general_knowledge, settings
    )


@router.post("/map/ask", response_model=AskResponse)
async def ask_map(
    body: MapAskRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_session),
) -> AskResponse:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Pragma"] = "no-cache"
    rate_limiter.check("plant_assistant", client_address(request))
    # Match the public map/detail visibility boundary. Fetch only reference
    # species fields, never coordinates, reports, identities or credentials.
    row = session.execute(
        select(Species.id, Species.latin_name)
        .join(Sighting, Sighting.species_id == Species.id)
        .where(
            Sighting.id == body.sighting_id,
            Sighting.status.in_({"screened", "removal_reported", "resolved_after_follow_up"}),
        )
    ).first()
    retriever = get_retriever()
    canonical = retriever.canonical(row[0]) if row else None
    if not canonical or retriever.canonical(row[1]) != canonical:
        return AskResponse(
            status="insufficient_evidence",
            answer="This public map record does not have a supported, consistent catalogue mapping. Select another supported public plant record. Private, withdrawn and uncertain records cannot provide assistant context.",
        )
    # A screened community record supplies catalogue context, not expert
    # identification or a claim that the species is present near the user.
    return await answer_for_species(
        canonical, body.question, body.depth, body.allow_general_knowledge, settings
    )


@router.post("/guide/ask", response_model=AskResponse)
async def ask_guide(
    body: GuideAskRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> AskResponse:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Pragma"] = "no-cache"
    rate_limiter.check("plant_assistant", client_address(request))
    canonical = get_retriever().canonical(body.species_id)
    if not canonical or canonical != body.species_id:
        return AskResponse(
            status="insufficient_evidence",
            answer="This guide does not have a supported catalogue reference. Browse a supported plant guide. This is not a plant identification.",
        )
    return await answer_for_species(
        canonical, body.question, body.depth, body.allow_general_knowledge, settings
    )


async def answer_for_species(
    species_id: str,
    question: str,
    depth: str,
    allow_general_knowledge: bool,
    settings: Settings,
) -> AskResponse:
    retriever = get_retriever()
    covered = retriever.covered_topics(species_id)
    if contains_private_details(question):
        return AskResponse(
            status="insufficient_evidence",
            answer="Please ask about the plant without personal details, coordinates, passwords or access codes.",
            covered_topics=covered,
        )
    hazard_scope = requested_hazard_aspect(retriever.factual_question(species_id, question))
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
            sources=stored_sources(retriever.search(species_id, question)),
            covered_topics=covered,
        )
    candidates = retriever.search(species_id, question)
    support = retriever.classify(species_id, question, candidates)
    evidence = support.evidence

    def insufficient() -> AskResponse:
        return AskResponse(
            status="insufficient_evidence",
            answer="The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.",
            sources=stored_sources(candidates),
            covered_topics=covered,
        )

    species = retriever.species[species_id].scientific_name
    loop = asyncio.get_running_loop()
    deadline = loop.time() + settings.assistant_request_timeout_seconds
    # Older panels do not understand the new label. Keep their source-only
    # behaviour until an updated client explicitly requests this capability.
    general_topic = eligible_general_question(question) if allow_general_knowledge else None

    def general_unavailable() -> AskResponse:
        return AskResponse(
            status="insufficient_evidence",
            answer="General botanical information is unavailable right now. This is not an answer about the selected plant. You can still ask about its approved source information.",
            covered_topics=covered,
        )

    async def general_or_insufficient() -> AskResponse:
        if not general_topic:
            return insufficient()
        if depth == "detailed":
            return AskResponse(
                status="insufficient_evidence",
                answer="Detailed general explanations are not available in this release. Ask for Standard or Simpler general botanical information instead.",
                covered_topics=covered,
            )
        remaining = max(0, deadline - loop.time())
        if remaining <= 0:
            return general_unavailable()
        general_settings = settings.model_copy(
            update={
                "assistant_generation_timeout_seconds": min(
                    settings.assistant_generation_timeout_seconds, remaining
                )
            }
        )
        try:
            answer = await asyncio.wait_for(
                generate_general(question, depth, general_settings), timeout=remaining
            )
        except TimeoutError:
            answer = None
        if not answer:
            return general_unavailable()
        return AskResponse(
            status="answer",
            answerability="answerable",
            answer=answer,
            answer_mode="general_knowledge",
        )

    if support.state == SupportState.HARD_BLOCK:
        # HARD_BLOCK also represents normal evidence gaps. The fully consumed
        # concept grammar proves these are educational requests, never safety
        # requests. The generic comparison examples have an old lookalike cue;
        # only these closed concept comparisons can cross that lexical gap.
        if general_topic and (
            support.reason in {"missing_evidence", "missing_requested_topic_evidence"}
            or (
                support.reason == "excluded_or_undocumented_aspect"
                and general_topic in {"annual and perennial plants", "simple and compound leaves"}
            )
        ):
            return await general_or_insufficient()
        return insufficient()
    if support.state == SupportState.NEEDS_SEMANTIC_REVIEW:
        if general_topic and depth == "detailed":
            # An unresolved verdict is not a verified evidence gap. Avoid
            # provider calls and offer an allowed level for strict review.
            return AskResponse(
                status="insufficient_evidence",
                answer="The approved sources need an evidence check for this question. Detailed general explanations are not available in this release. Try Standard or Simpler.",
                covered_topics=covered,
            )
        judge_call = (
            evaluate(question, species, evidence, settings, closed_negative=True)
            if general_topic
            else evaluate(question, species, evidence, settings)
        )
        try:
            judgement = await asyncio.wait_for(
                judge_call,
                timeout=min(settings.assistant_judge_timeout_seconds, deadline - loop.time()),
            )
        except TimeoutError:
            return general_unavailable() if general_topic else insufficient()
        evidence = validate_judgement(judgement, question, species, evidence)
        if not evidence:
            if explicit_evidence_gap(judgement, species):
                return await general_or_insufficient()
            return general_unavailable() if general_topic else insufficient()

    def fallback() -> AskResponse:
        answer, used = fallback_evidence(retriever, species_id, evidence, depth)
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
            generate(question, species, evidence, depth, generation_settings),
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
                answer_mode="grounded",
                answer=answer,
                sources=stored_sources(used),
            )
    return fallback()
