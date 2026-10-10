"""Ephemeral plant questions using the current scan and reviewed evidence."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import ApiModel
from app.config import Settings, get_settings
from app.core.rate_limit import client_address, rate_limiter
from app.db.base import get_session
from app.db.models import Sighting, Species
from app.domain.plant_assistant import (
    SAFETY_BOUNDARY,
    contains_private_details,
    eligible_evidence,
    get_retriever,
)
from app.services.assistant_conversation import AI_WARNING, answer_conversation

router = APIRouter(prefix="/api/v1/plant-assistant", tags=["plant-assistant"])


class ConversationMessage(ApiModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=3000)


class ConversationRequest(ApiModel):
    history: list[ConversationMessage] = Field(default_factory=list, max_length=8)
    previous_answer: str | None = Field(default=None, max_length=4000)


class AskRequest(ConversationRequest):
    species_id: str | None = Field(default=None, max_length=120)
    classifier_confidence: float = Field(ge=0, le=1, allow_inf_nan=False)
    classifier_outcome: Literal["target", "other_plant", "uncertain"] | None = None
    question: str = Field(min_length=1, max_length=600)
    depth: Literal["standard", "simpler", "detailed"] = "standard"
    allow_general_knowledge: bool = False
    section_aware: bool = False

    @field_validator("question")
    @classmethod
    def nonempty_question(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter a question")
        return value


class MapAskRequest(ConversationRequest):
    # Only a genuine public sighting is accepted. No client species or scan fields.
    sighting_id: uuid.UUID
    question: str = Field(min_length=1, max_length=600)
    depth: Literal["standard", "simpler", "detailed"] = "standard"
    allow_general_knowledge: bool = False
    section_aware: bool = False

    @field_validator("question")
    @classmethod
    def nonempty_question(cls, value: str) -> str:
        return AskRequest.nonempty_question(value)


class GuideAskRequest(ConversationRequest):
    # A public catalogue reference, never a verified observation or scan.
    species_id: str = Field(min_length=1, max_length=120)
    question: str = Field(min_length=1, max_length=600)
    depth: Literal["standard", "simpler", "detailed"] = "standard"
    allow_general_knowledge: bool = False
    section_aware: bool = False

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


class AnswerSection(ApiModel):
    kind: Literal["grounded", "ai", "conversation", "unavailable"]
    title: str
    answer: str
    depth: Literal["standard", "simpler", "detailed"] = "standard"
    sources: list[Source] = Field(default_factory=list)
    warning: str | None = None

    @model_validator(mode="after")
    def citation_boundary(self):
        if self.kind != "grounded" and self.sources:
            raise ValueError("Only reviewed sections can carry source citations")
        if self.kind == "ai" and self.warning != AI_WARNING:
            raise ValueError("AI sections require the accuracy warning and an allowed depth")
        return self


class AskResponse(ApiModel):
    status: Literal["answer", "fallback", "insufficient_evidence", "unsupported_scan"]
    answerability: Literal["answerable", "insufficient_evidence"] = "insufficient_evidence"
    answer: str
    sources: list[Source] = Field(default_factory=list)
    safety_boundary: str = SAFETY_BOUNDARY
    covered_topics: list[str] = Field(default_factory=list)
    answer_mode: Literal["grounded", "general_knowledge", "fallback"] = "fallback"
    coverage: Literal["fully_supported", "partially_supported", "unsupported", "uncertain"] = (
        "uncertain"
    )
    intent: Literal[
        "botanical", "catalogue", "greeting", "off_topic", "ambiguous", "restricted"
    ] = "botanical"
    sections: list[AnswerSection] = Field(default_factory=list)
    mixed_depth_notice: str | None = None


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


def context_evidence_failure() -> AskResponse:
    message = "The reviewed evidence could not be loaded. Please try again; AI knowledge has not been substituted."
    return AskResponse(
        status="insufficient_evidence",
        answer=message,
        coverage="uncertain",
        sections=[
            AnswerSection(kind="unavailable", title="Evidence check unavailable", answer=message)
        ],
    )


def context_retriever(section_aware: bool):
    try:
        return get_retriever()
    except (RuntimeError, ValueError, TypeError, KeyError, OSError):
        if not section_aware:
            raise
        return None


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
    retriever = context_retriever(body.section_aware)
    if retriever is None:
        return context_evidence_failure()
    species_id = retriever.canonical(body.species_id)
    if not species_id:
        return unsupported_scan_response()
    return await answer_for_species(
        species_id,
        body.question,
        body.depth,
        body.allow_general_knowledge,
        settings,
        section_aware=body.section_aware,
        history=[m.model_dump() for m in body.history],
        previous_answer=body.previous_answer,
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
    retriever = context_retriever(body.section_aware)
    if retriever is None:
        return context_evidence_failure()
    canonical = retriever.canonical(row[0]) if row else None
    if not canonical or retriever.canonical(row[1]) != canonical:
        return AskResponse(
            status="insufficient_evidence",
            answer="This public map record does not have a supported, consistent catalogue mapping. Select another supported public plant record. Private, withdrawn and uncertain records cannot provide assistant context.",
        )
    # A screened community record supplies catalogue context, not expert
    # identification or a claim that the species is present near the user.
    return await answer_for_species(
        canonical,
        body.question,
        body.depth,
        body.allow_general_knowledge,
        settings,
        section_aware=body.section_aware,
        history=[m.model_dump() for m in body.history],
        previous_answer=body.previous_answer,
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
    retriever = context_retriever(body.section_aware)
    if retriever is None:
        return context_evidence_failure()
    canonical = retriever.canonical(body.species_id)
    if not canonical or canonical != body.species_id:
        return AskResponse(
            status="insufficient_evidence",
            answer="This guide does not have a supported catalogue reference. Browse a supported plant guide. This is not a plant identification.",
        )
    return await answer_for_species(
        canonical,
        body.question,
        body.depth,
        body.allow_general_knowledge,
        settings,
        section_aware=body.section_aware,
        history=[m.model_dump() for m in body.history],
        previous_answer=body.previous_answer,
    )


async def answer_for_species(
    species_id: str,
    question: str,
    depth: str,
    allow_general_knowledge: bool,
    settings: Settings,
    *,
    section_aware: bool = False,
    history: list[dict] | None = None,
    previous_answer: str | None = None,
) -> AskResponse:
    """All clients use the conversation engine; no legacy routing or rollout switch."""
    # Privacy applies even when the provider is disabled or unavailable.
    if contains_private_details(question):
        return AskResponse(
            status="insufficient_evidence",
            intent="restricted",
            answer="Please ask about plants without personal details or credentials.",
        )
    try:
        result = await answer_conversation(
            species_id,
            question,
            depth,
            allow_general_knowledge,
            settings,
            history=history or [],
            previous_answer=previous_answer,
        )
        if result is not None:
            return AskResponse.model_validate(result)
    except (TimeoutError, RuntimeError, ValueError, TypeError, KeyError, OSError):
        pass
    message = (
        "The AI explanation could not be completed. Please try again. "
        "This does not mean your question is unclear or unrelated to plants."
    )
    sections = [
        AnswerSection(
            kind="unavailable",
            title="AI explanation unavailable",
            answer=message,
            depth=depth,
        )
    ]
    # Excerpts are offered as reference material, never as an inferred answer.
    # Search is retrieval only: it does not route or classify the user's question.
    try:
        retriever = get_retriever()
        chunks = [c for c in retriever.search(species_id, question) if eligible_evidence(c)]
    except (RuntimeError, ValueError, TypeError, KeyError, OSError):
        chunks = []
    if chunks:
        sections.append(
            AnswerSection(
                kind="grounded",
                title="Related source excerpts",
                depth=depth,
                answer="\n\n".join(c["content"] for c in chunks),
                sources=stored_sources(chunks),
            )
        )
    return AskResponse(
        status="insufficient_evidence",
        answer=message,
        sections=sections,
        sources=stored_sources(chunks),
        coverage="uncertain",
    )
