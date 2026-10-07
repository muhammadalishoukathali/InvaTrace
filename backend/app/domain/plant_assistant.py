"""Species-filtered evidence retrieval and conservative question-specific gating."""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from enum import StrEnum
from functools import lru_cache
from pathlib import Path

from app.domain.assistant_safety import requests_bounded_safety, supported_safety_evidence
from app.domain.catalogue import load_status_records

KNOWLEDGE_PATH = Path(__file__).resolve().parents[1] / "data" / "plant-assistant-knowledge.json"
SAFETY_BOUNDARY = (
    "This assistant does not grant permission to touch, collect, transport or remove a plant, "
    "or to enter restricted areas. Follow the existing safety, site-permission and protected-area "
    "checks. If permission or protection is uncertain, leave the plant undisturbed and observe "
    "from a safe, permitted location."
)
TOPIC_CUES = {
    "identification": r"\b(appearance|visual|clues?|characteristics?|features?|look|looks|leaf|leaves|flowers?|stems?|fruits?|pods?|bark|recognis\w*|recogniz\w*)\b",
    "habitat": r"\b(where|habitat|found|find|grow|grows|growing|environment|live|lives|occur\w*)\b",
    "impact": r"\b(impact\w*|invasive|harm\w*|damage|effect\w*|affect\w*|problem\w*|threat\w*|compete|competition)\b",
    "spread": r"\b(spread\w*|dispers\w*|travel|travels|propagat\w*|reproduc\w*)\b",
    "safe_response": r"\b(safe|safely|safety|respond|response|report\w*|observe|photograph|found it|what should|what do i do)\b",
    "toxicity": r"\b(toxic\w*|poison\w*|touch\w*|edible|eat|eating|ingest\w*|allerg\w*|irritat\w*|rash|skin)\b",
    "removal": r"\b(remov\w*|pull\w*|cut\w*|kill|burn\w*|herbicide|pesticide|transport|carry|collect|handle|handling|permission|allowed|authoris\w*|authoriz\w*|protected|restricted|enter)\b",
    "lookalike": r"\b(lookalike\w*|look-alike\w*|differentiat\w*|distinguish|difference|compare|confused)\b",
    "legal": r"\b(legal\w*|illegal\w*|law\w*|possess|fine|penalty|ban\w*|regulat\w*)\b",
}
# A topic label is not evidence for one of these narrower factual questions.
FACETS = {
    "rate": (
        r"\d|\b(how[\s-]+(?:fast|quick(?:ly)?|rapid(?:ly)?|slow(?:ly)?)|rate|speed|how long|how many|how much|how tall|height|size|metres?|meters?|centimet\w*|days?|weeks?|years?)\b",
        r"\d",
    ),
    "animals": (
        r"\b(animals?|pets?|dogs?|cats?|cattle|livestock|fish)\b",
        r"\b(animals?|pets?|dogs?|cats?|cattle|livestock|fish)\b",
    ),
    "health": (
        r"\b(medicin\w*|health|cure|treat|disease|illness|children|babies|pregnan\w*)\b",
        r"\b(medicin\w*|health|cure|treat|disease|illness|children|babies|pregnan\w*)\b",
    ),
    "seeds": (r"\b(seeds?|seedlings?)\b", r"\b(seeds?|seedlings?)\b"),
    "flowers": (r"\b(flowers?|flowering|blooms?)\b", r"\b(flowers?|flowering|blooms?)\b"),
    "leaves": (r"\b(leaves?|leaf)\b", r"\b(leaves?|leaf|phyllodes)\b"),
    "water": (
        r"\b(water|flood\w*|rivers?|streams?|ponds?|lakes?)\b",
        r"\b(water\w*|flood\w*|river\w*|stream\w*|pond\w*|lake\w*)\b",
    ),
    "wind": (r"\b(wind|air)\b", r"\b(wind|air)\b"),
    "native": (r"\b(native|local plants|forest)\b", r"\b(native|forest\w*)\b"),
}
QUERY_STOPWORDS = frozenset(
    {"like", "plants", "near", "other", "might", "find", "main", "visual", "clue", "clues", "so"}
) | frozenset(
    [
        "a",
        "an",
        "the",
        "it",
        "its",
        "this",
        "that",
        "these",
        "those",
        "plant",
        "species",
        "can",
        "could",
        "would",
        "should",
        "do",
        "does",
        "did",
        "is",
        "are",
        "was",
        "were",
        "will",
        "be",
        "been",
        "being",
        "i",
        "we",
        "you",
        "they",
        "me",
        "my",
        "our",
        "your",
        "their",
        "of",
        "for",
        "from",
        "in",
        "on",
        "at",
        "to",
        "with",
        "and",
        "or",
        "as",
        "by",
        "about",
        "what",
        "why",
        "how",
        "where",
        "which",
        "when",
        "tell",
        "explain",
        "explanation",
        "simple",
        "simpler",
        "detail",
        "detailed",
        "more",
        "please",
        "know",
        "means",
        "mean",
        "result",
        "scan",
        "grows",
        "grow",
        "found",
        "habitat",
        "appearance",
        "characteristics",
        "characteristic",
        "features",
        "feature",
        "looks",
        "look",
        "impact",
        "impacts",
        "invasive",
        "harm",
        "harmful",
        "spread",
        "spreads",
        "spreading",
        "response",
        "safe",
        "safely",
        "safety",
        "respond",
        "information",
        "happens",
        "effect",
        "effects",
        "affect",
        "affects",
        "report",
        "reporting",
        "usually",
        "typically",
        "normally",
        "generally",
        "common",
        "mainly",
        "recognise",
        "recognize",
        "need",
        "want",
        "describe",
        "description",
        "environment",
        "lives",
        "live",
        "learn",
        "help",
        "learning",
    ]
)


def words(text: str) -> list[str]:
    return re.findall(r"[a-z]+", text.casefold())


def normalize_query(text: str) -> str:
    aliases = {
        "habitats": "habitat",
        "inhabit": "grow",
        "inhabits": "grows",
        "inhabiting": "growing",
        "locations": "habitat",
        "environments": "environment",
    }
    return re.sub(r"\b[a-z]+\b", lambda m: aliases.get(m[0], m[0]), text.casefold())


def terms(text: str) -> list[str]:
    tokens = words(text)
    return tokens + [f"{a} {b}" for a, b in zip(tokens, tokens[1:], strict=False)]


def stem(word: str) -> str:
    aliases = {
        "leaves": "leaf",
        "phyllodes": "leaf",
        "riverbanks": "river",
        "riverbank": "river",
        "waterways": "water",
        "floodwater": "water",
        "fast": "rapid",
        "quick": "rapid",
        "quickly": "rapid",
        "rapidly": "rapid",
    }
    if word in aliases:
        return aliases[word]
    for ending in ("ing", "es", "s"):
        if word.endswith(ending) and len(word) > len(ending) + 3:
            return word[: -len(ending)]
    return word


def requested_topics(question: str) -> set[str]:
    if requests_bounded_safety(question):
        # Reuse the existing topic boost to retrieve safety, not to prove it.
        # Source-specific objects, negations and conditions decide sufficiency.
        return {"safe_response"}
    topics = {topic for topic, pattern in TOPIC_CUES.items() if re.search(pattern, question, re.I)}
    if re.search(
        r"\b(scan|result|what is this plant|what plant is this|tell me about|explain this plant)\b",
        question,
        re.I,
    ):
        topics.add("identification")
    # A toxicity or removal question is not made answerable by generic safety.
    if topics & {"toxicity", "removal", "legal", "lookalike"}:
        topics.discard("safe_response")
    if re.search(
        r"\b(where|who|whom|how|contact|phone|number|authority)\b", question, re.I
    ) and re.search(r"\breport\w*\b", question, re.I):
        topics = (topics - {"safe_response", "habitat"}) | {"reporting"}
    if "spread" in topics:
        topics.discard("impact") if not re.search(
            r"\b(impact|harm|invasive|damage)\b", question, re.I
        ) else None
    return topics


def eligible_evidence(chunk: dict) -> bool:
    """Unreviewed/legacy templates cannot establish an answer or topic coverage."""
    return chunk.get("evidence_status", "reviewed") == "reviewed" and not chunk[
        "content"
    ].startswith("The approved catalogue records water as a spread pathway")


def requested_hazard_aspect(question: str) -> str | None:
    """Closed plant-hazard questions; compound actions/medical advice fail closed.

    Intent is not evidence. Scope must subsequently match a reviewed hazard.
    """
    question = " ".join(question.casefold().split()).rstrip(".!?")
    # factual_question removes the complete scanned name; restore only a
    # subject placeholder for a fully consumed "is <property>" question.
    question = re.sub(
        r"^is (?=(?:safe|harmful|harmless|edible|poisonous|toxic|non-toxic)\b)",
        "is this plant ",
        question,
    )
    subject = r"(?:it|this(?: plant)?|the plant)"
    patterns = {
        "contact": rf"(?:is {subject} (?:safe|harmful) to touch(?: (?:this plant|the plant|it))?|(?:can|could|should) i touch {subject}|does {subject} (?:cause (?:skin irritation|a rash)|irritate (?:the )?skin))",
        "handling": rf"(?:is {subject} (?:safe|harmful) to handle|(?:can|could|should) i handle {subject})",
        "ingestion": rf"(?:is {subject} (?:safe to eat|harmful to eat|edible|poisonous|toxic|non-toxic)|(?:can|could|should) i eat {subject})",
        "general": rf"(?:is {subject} (?:safe|harmful|harmless)|what (?:are (?:the |its )?hazards|hazards does {subject} have))",
    }
    return next(
        (scope for scope, pattern in patterns.items() if re.fullmatch(pattern, question)), None
    )


def unsupported_specific_aspect(question: str) -> bool:
    """Current pack has no reviewed timing, user-local presence or safe assurance.

    These question aspects cannot be inferred from a matching broad topic.
    Bounded observation/prohibition intents are handled separately first.
    """
    timing = r"\b(when|season\w*|months?|time of (?:the )?year|what time|which time)\b"
    local_presence = r"\b(near (?:me|us)|nearby|around (?:me|us|here)|in (?:my|our|this) (?:area|neighbou?rhood|location|city|town)|where i (?:am|live)|local to (?:me|us)|here)\b"
    safety_property = r"\b(?:is|are|would|could|can)\b.*\b(?:safe|harmless|non-toxic)\b"
    return bool(
        re.search(timing, question, re.I)
        or re.search(local_presence, question, re.I)
        or re.search(safety_property, question, re.I)
        or requested_hazard_aspect(question)
    )


def requests_ranked_spread(question: str) -> bool:
    """Detect pathway ranking before general-purpose stopwords are discarded."""
    if not re.search(TOPIC_CUES["spread"], question, re.I):
        return False
    ranked_path = (
        r"\b(main|primary|dominant|predominant|principal|chief|major|leading|most common|most important)"
        r"\s+(?:(?!(?:visual|appearance|identification|clues?|features?|characteristics?|what|how|does|do|did|is|are|can|should)\b)[a-z-]+\s+){0,6}"
        r"(spread\w*|dispers\w*|propagat\w*|reproduc\w*|pathways?|routes?|ways?|modes?|methods?|mechanisms?|vectors?|means)\b"
    )
    # Keep an appearance clause's "main visual clues" separate from a plain
    # spread clause. Preserve "water and wind" within a ranked noun phrase,
    # but stop at a conjunction introducing another question or subject.
    clauses = re.split(
        r"[.!?;,:]|\bbut\b|\band\b(?=\s+(?:does|do|did|is|are|what|how|where|why|can|should|it|this|they)\b)",
        question,
        flags=re.I,
    )
    for clause in clauses:
        if re.search(ranked_path, clause, re.I):
            return True
        # Incomplete/predicative ranking still constrains the question. Only
        # a clear appearance-summary noun phrase accounts for an ordinary
        # "main"; a remaining main in a spread clause cannot vanish later.
        without_appearance_summary = re.sub(
            r"\bmain\s+(?:(?:visual|identification|identifying)\s+)?(?:clues?|features?|characteristics?|appearance)\b",
            " ",
            clause,
            flags=re.I,
        )
        if re.search(TOPIC_CUES["spread"], clause, re.I) and re.search(
            r"\bmain\b", without_appearance_summary, re.I
        ):
            return True
        if re.search(TOPIC_CUES["spread"], clause, re.I) and re.search(
            r"\b(mainly|primarily|dominantly|predominantly|principally|chiefly|mostly|most often)\b",
            clause,
            re.I,
        ):
            return True
    return False


class SupportState(StrEnum):
    HARD_BLOCK = "HARD_BLOCK"
    DEMONSTRABLY_SUPPORTED = "DEMONSTRABLY_SUPPORTED"
    NEEDS_SEMANTIC_REVIEW = "NEEDS_SEMANTIC_REVIEW"


@dataclass(frozen=True)
class SupportClassification:
    state: SupportState
    evidence: list[dict]
    reason: str


def question_aspects(question: str) -> list[str]:
    # Preserve every original clause, including conjunctions inside noun lists.
    # This is a coverage contract, not an automated entailment proof.
    return [p.strip() for p in re.split(r"[?;]|\band\b|\bbut\b", question, flags=re.I) if p.strip()]


class EvidenceRetriever:
    """The feasibility TF-IDF algorithm, with no embedding/runtime dependencies."""

    def __init__(self, chunks: list[dict] | None = None):
        pack = json.loads(KNOWLEDGE_PATH.read_text()) if chunks is None else None
        self.chunks = pack["chunks"] if pack else chunks
        statuses = load_status_records()
        self.species = {record.species_id: record for record in statuses}
        self.aliases = {
            alias.casefold(): record.species_id
            for record in statuses
            for alias in (record.species_id, record.scientific_name, record.model_label)
        }
        if pack and (pack["species_count"] != 32 or len(self.species) != 32):
            raise ValueError("Expected the current 32 plant categories")
        if pack and (
            pack["chunk_count"] != len(self.chunks)
            or {c["species_id"] for c in self.chunks} != set(self.species)
        ):
            raise ValueError("Evidence pack count or coverage is inconsistent")
        if any(
            not c["content"].strip()
            or not c["sources"]
            or any(not s["url"].startswith("https://") for s in c["sources"])
            for c in self.chunks
        ):
            raise ValueError("Evidence requires content and stored HTTPS sources")
        ids = [chunk["chunk_id"] for chunk in self.chunks]
        if len(ids) != len(set(ids)) or any(
            c["species_id"] not in self.species for c in self.chunks
        ):
            raise ValueError("Invalid evidence species or duplicate chunk ID")
        counts = [Counter(terms(f"{c['topic']} {c['content']}")) for c in self.chunks]
        df = Counter(term for count in counts for term in count)
        self.idf = {term: math.log((1 + len(counts)) / (1 + n)) + 1 for term, n in df.items()}
        self.vectors = [self._vector(count) for count in counts]

    def canonical(self, species: str | None) -> str | None:
        return self.aliases.get((species or "").strip().casefold())

    def factual_question(self, species_id: str, question: str) -> str:
        """Exclude complete names of the scanned plant from factual cue checks.

        A word such as "water" in "Water hyacinth" names the plant; a
        separate occurrence in "by water" still needs dispersal evidence.
        Names of other species are retained, so they cannot change the scan.
        """
        question = " ".join(question.split())
        record = self.species.get(species_id)
        if record is None:
            return question
        names = (record.scientific_name, record.common_name, record.model_label, species_id)
        for name in sorted((n for n in names if n), key=len, reverse=True):
            pattern = r"\b" + r"[\s_-]+".join(map(re.escape, words(name))) + r"\b"
            question = re.sub(pattern, " ", question, flags=re.I)
        return question

    def _vector(self, counts: Counter) -> dict[str, float]:
        weights = {t: (1 + math.log(n)) * self.idf[t] for t, n in counts.items() if t in self.idf}
        norm = math.sqrt(sum(w * w for w in weights.values()))
        return {t: w / norm for t, w in weights.items()} if norm else {}

    def search(self, species_id: str, question: str, top_k: int = 5) -> list[dict]:
        question = normalize_query(self.factual_question(species_id, question))
        query = self._vector(Counter(terms(question)))
        topics = requested_topics(normalize_query(question))
        candidates = []
        for chunk, vector in zip(self.chunks, self.vectors, strict=True):
            if chunk["species_id"] != species_id or not eligible_evidence(chunk):
                continue
            score = sum(w * vector.get(t, 0) for t, w in query.items())
            if chunk["topic"] in topics:
                score += 0.35
            if score > 0:
                candidates.append(dict(chunk, score=round(score, 6)))
        return sorted(candidates, key=lambda c: (-c["score"], c["chunk_id"]))[:top_k]

    def covered_topics(self, species_id: str) -> list[str]:
        available = {
            c["topic"]
            for c in self.chunks
            if c["species_id"] == species_id and eligible_evidence(c)
        }
        order = (
            "identification",
            "habitat",
            "impact",
            "spread",
            "safe_response",
            "documented_hazards",
            "names_status",
            "origin",
            "life_cycle",
        )
        return [topic for topic in order if topic in available]

    def documented_hazards(self, species_id: str, scope: str) -> list[dict]:
        # Scope is explicit reviewed metadata, never inferred from topic/overlap.
        return [
            dict(c)
            for c in self.chunks
            if c["species_id"] == species_id
            and c["topic"] == "documented_hazards"
            and eligible_evidence(c)
            and c.get("hazard_scopes")
            and (scope == "general" or scope in c["hazard_scopes"])
        ]

    def sufficient(self, species_id: str, question: str, candidates: list[dict]) -> list[dict]:
        """Legacy calibration helper; runtime support uses classify instead."""
        candidates = [c for c in candidates if eligible_evidence(c)]
        question = self.factual_question(species_id, question)
        if requests_bounded_safety(question):
            # A recognised request with no matching negative/observation clause
            # must not fall through to generic word-overlap acceptance.
            return supported_safety_evidence(species_id, question, candidates)
        if unsupported_specific_aspect(question):
            return []
        topics = requested_topics(question)
        if not topics or topics & {"toxicity", "removal", "legal", "lookalike"}:
            return []
        if requests_ranked_spread(question):
            # This pack has no reviewed pathway-ranking facts. A pathway's
            # existence, or unrelated "main/major" wording, cannot establish
            # dominance. Do not enable ranking via a keyword-presence test.
            return []
        selected = [
            c
            for c in candidates
            if c["species_id"] == species_id and c["topic"] in topics and c["score"] > 0
        ]
        if not topics.issubset({c["topic"] for c in selected}):
            return []
        text = " ".join(c["content"] for c in selected)
        for question_pattern, evidence_pattern in FACETS.values():
            if re.search(question_pattern, question, re.I) and not re.search(
                evidence_pattern, text, re.I
            ):
                return []
        # Conservative additional filter, not a proof of semantic grounding.
        # Require specific concepts in the question to occur in the evidence.
        # Broad topic questions have no extra concepts; a plant/topic match is
        # never enough for, for example, an animal-health or numeric claim.
        concepts = {stem(w) for w in words(question) if w not in QUERY_STOPWORDS}
        evidence_words = {stem(w) for w in words(text)}
        if not concepts.issubset(evidence_words):
            return []
        return selected

    def classify(
        self, species_id: str, question: str, candidates: list[dict]
    ) -> SupportClassification:
        question = self.factual_question(species_id, question)
        eligible = [c for c in candidates if c["species_id"] == species_id and eligible_evidence(c)]

        def blocked(reason: str) -> SupportClassification:
            return SupportClassification(SupportState.HARD_BLOCK, [], reason)

        if species_id not in self.species or contains_private_details(question):
            return blocked("species_or_private_context")
        if requests_bounded_safety(question):
            support = supported_safety_evidence(species_id, question, eligible)
            return (
                SupportClassification(
                    SupportState.DEMONSTRABLY_SUPPORTED, support, "closed_safety_relation"
                )
                if support
                else blocked("unsupported_safety_relation")
            )
        topics = requested_topics(normalize_query(question))
        if (
            unsupported_specific_aspect(question)
            or requests_ranked_spread(question)
            or topics & {"toxicity", "removal", "legal", "lookalike", "reporting"}
            or re.search(FACETS["health"][0], question, re.I)
            or re.search(FACETS["rate"][0], question, re.I)
            or re.search(
                r"\b(primary|dominant|largest|smallest|best|worst|most|least|mainly|primarily|mostly|always|only|usually|typically|normally|generally|often)\b",
                question,
                re.I,
            )
            or re.search(
                r"\b(?:my|our|your|their|his|her)\b.{0,45}\b(?:areas?|locations?|neighbou?rhood|city|town|gardens?|suburbs?|property|backyard|home|land)\b",
                question,
                re.I,
            )
            or (
                re.search(FACETS["animals"][0], question, re.I)
                and (
                    topics & {"impact", "toxicity"}
                    or re.search(r"\b(hurt|injur\w*|sick\w*|danger\w*|die|death)\b", question, re.I)
                )
            )
        ):
            return blocked("excluded_or_undocumented_aspect")
        without_visual_summary = re.sub(
            r"\bmain\s+(?:(?:visual|identification|identifying)\s+)?(?:clues?|features?|characteristics?|appearance)\b",
            " ",
            question,
            flags=re.I,
        )
        if re.search(r"\bmain\b", without_visual_summary, re.I):
            return blocked("undocumented_ranking")
        for other_id, record in self.species.items():
            if other_id != species_id and any(
                name and re.search(r"\b" + re.escape(name) + r"\b", question, re.I)
                for name in (record.scientific_name, record.common_name, other_id)
            ):
                return blocked("foreign_species")
        if not eligible:
            return blocked("missing_evidence")
        selected = [c for c in eligible if c["topic"] in topics]
        if topics and not topics.issubset({c["topic"] for c in selected}):
            return blocked("missing_requested_topic_evidence")
        concepts = {stem(w) for w in words(normalize_query(question)) if w not in QUERY_STOPWORDS}
        if re.search(r"\b(why|because|if|unless|than|versus|compared)\b", question, re.I) or (
            re.search(r"\b(i|we)\b", question, re.I)
            and not (topics == {"safe_response"} and not concepts)
        ):
            return SupportClassification(
                SupportState.NEEDS_SEMANTIC_REVIEW,
                selected or eligible,
                "action_condition_or_comparison",
            )
        if not topics:
            return SupportClassification(
                SupportState.NEEDS_SEMANTIC_REVIEW, eligible, "unrecognised_relation"
            )
        # Broad topic requests are completely consumed; any specific property,
        # comparison, cause or condition goes to semantic review, not overlap.
        if not concepts:
            return SupportClassification(
                SupportState.DEMONSTRABLY_SUPPORTED, selected, "whole_topic"
            )
        # Reviewed relation metadata is bound to the exact complete paragraph.
        # Facet ownership is explicit, never inferred from matching words.
        proven = set()
        for chunk in selected:
            direct = chunk.get("direct_support", {})
            if (
                direct.get("content_sha256")
                != hashlib.sha256(chunk["content"].encode()).hexdigest()
            ):
                continue
            if chunk["topic"] == "spread":
                proven.update(direct.get("spread_pathways", []))
            if chunk["topic"] == "habitat":
                proven.update(direct.get("habitat_contexts", []))
        # An identification topic does not prove every plant component exists
        # in its paragraph. Component-specific requests need semantic review
        # unless an independently reviewed relation is explicitly recorded.
        if concepts.issubset(proven):
            return SupportClassification(
                SupportState.DEMONSTRABLY_SUPPORTED, selected, "reviewed_direct_relation"
            )
        return SupportClassification(
            SupportState.NEEDS_SEMANTIC_REVIEW, selected, "specific_relation"
        )


@lru_cache
def get_retriever() -> EvidenceRetriever:
    return EvidenceRetriever()


def contains_private_details(question: str) -> bool:
    return bool(
        re.search(
            r"[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(password|credential|api.?key|token|recovery.?code|gps|latitude|longitude)\b|"
            r"\b(?:AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{20,})\b|"
            r"\b(?:my|our)\s+(?:full name|name|address|phone(?: number)?|student id|user id)\b|"
            r"\b(?:date of birth|profile id|installation id|session id)\b|"
            r"\b(?:i|we)\s+(?:live|reside|stay|am\s+(?:living|staying)|are\s+(?:living|staying))\s+(?:at|in)\b|"
            r"\b(?:i['’]m|we['’]re)\s+(?:living|staying)\s+(?:at|in)\b|"
            r"[-+]?\d{1,3}\.\d{3,}\s*[,; ]\s*[-+]?\d{1,3}\.\d{3,}|\b\d{9,}\b",
            question,
            re.I,
        )
    )


def protected_chunks(evidence: list[dict]) -> list[dict]:
    """Complete safety paragraphs stay backend controlled at every depth."""
    return [
        c
        for c in evidence
        if c.get("safety_critical")
        or c["topic"] in {"safe_response", "documented_hazards"}
        or re.search(
            r"\b(toxic\w*|poison\w*|irrita\w*|dermatitis|hay fever|permission|do not|never|avoid|restricted|protected area)\b",
            c["content"],
            re.I,
        )
    ]


def validate_generated(
    payload: object, evidence: list[dict], species: str | None = None
) -> tuple[str, list[dict]] | None:
    """Validate structure and protected boundaries, not semantic grounding.

    The legacy three-field format remains exact-paragraph only. The species-
    echoed format permits non-safety prose; the router must apply its separate
    final semantic gate before display. Human release review is still required.
    Neither IDs nor vocabulary overlap proves factual support.
    """
    if not isinstance(payload, dict) or set(payload) not in (
        {"status", "answer", "used_chunk_ids"},
        {"status", "species", "answer", "used_chunk_ids"},
        {"status", "species", "sentences", "answer", "used_chunk_ids"},
    ):
        return None
    answer, ids = payload["answer"], payload["used_chunk_ids"]
    if "sentences" in payload:
        from app.services.assistant_grounding import valid_input

        botanical = [c for c in evidence if c not in protected_chunks(evidence)]
        if not valid_input(species or payload.get("species"), payload["sentences"], botanical, ids):
            return None
        if answer != " ".join(payload["sentences"]):
            return None
    if (
        payload["status"] != "answer"
        or not isinstance(answer, str)
        or not answer.strip()
        or len(answer) > 8000
        or not isinstance(ids, list)
        or not ids
        or any(not isinstance(i, str) for i in ids)
        or len(ids) != len(set(ids))
    ):
        return None
    by_id = {c["chunk_id"]: c for c in evidence}
    if len(by_id) != len(evidence) or any(i not in by_id for i in ids):
        return None
    used = [by_id[i] for i in ids]
    if "species" not in payload:
        if set(ids) != set(by_id):
            return None
        expected = " ".join(c["content"] for c in used)
        return (expected, used) if " ".join(answer.split()) == " ".join(expected.split()) else None

    canonical = species or next(iter({c.get("species") for c in evidence}), None)
    if (
        not canonical
        or payload["species"] != canonical
        or any(c.get("species") != canonical for c in evidence)
    ):
        return None
    protected = protected_chunks(evidence)
    protected_ids = {c["chunk_id"] for c in protected}
    non_safety_ids = set(by_id) - protected_ids
    # All support-approved botanical chunks remain represented; safety IDs
    # cannot be claimed by the model because those paragraphs were not sent.
    if not non_safety_ids or set(ids) != non_safety_ids:
        return None
    # Use subject-led botanical descriptions; sentence fragments with an
    # article are permitted, but sentence-start directives are not.
    # This is a bounded presentation contract, not a grammatical or semantic
    # proof. It does not infer safety from a growing verb list.
    record = next(
        (r for r in get_retriever().species.values() if r.scientific_name == canonical), None
    )
    subjects = ["it", "its", "this", "these", "they", "their", "the", "a", "an", canonical]
    if record and record.common_name:
        subjects.append(record.common_name)
    subject_pattern = r"^(?:" + "|".join(re.escape(s) for s in subjects) + r")(?!\w)"
    sentences = [s.strip() for s in re.split(r"[.!?\n]+", answer) if s.strip()]
    if not sentences or any(not re.match(subject_pattern, s, re.I) for s in sentences):
        return None
    if contains_private_details(answer) or re.search(
        r"https?://|www\.|\[[^\]]+\]\(|\b[a-z0-9-]+\.(?:com|org|net|gov|edu|example)\b|"
        r"\b(safe|safely|safety|harmless|non-toxic|permission|allowed|authoris\w*|authoriz\w*|"
        r"toxic\w*|poison\w*|irrita\w*|dermatitis|hay fever|restricted|protected area|"
        r"should|must|never|avoid|recommend\w*|legal\w*|medical|cure|treat|"
        r"touch\w*|handl\w*|collect\w*|remov\w*|pull\w*|cut\w*|transport\w*|enter|dig|uproot\w*|pluck\w*|herbicide|pesticide|burn\w*|hazard\w*|danger\w*|edible|allerg\w*|injur\w*)\b|"
        r"\b(?:you|we|i)\s+(?:can|may|could|should|must)\b|"
        r"\b(?:you|your|we|our|i|my|advice|instructions?|suggest\w*|strateg\w*)\b|"
        r"\b(report\w*|observ\w*|photograph\w*|inspect\w*|approach\w*|proceed\w*|place|return|wear|gloves|pick|take|keep|leave|stay|stand)\b|"
        r"\b(?:go|walk|wade|swim|step|climb)\b.{0,60}\b(?:water|pond|river|stream|lake|area|site|fence)\b|"
        r"(?:^|[.!?\n:])\s*(?:please\s+)?(?:go|walk|wade|swim|step|climb|use|map|look|get|give)\b|"
        r"\b(classifier|classified|classification|Malaysian status|instead of|actually is)\b|"
        r"\b(mainly|primarily|usually|typically|always|only|dominant|primary|most|least|best|worst)\b",
        answer,
        re.I,
    ):
        return None
    retriever = get_retriever()
    for record in retriever.species.values():
        if record.scientific_name == canonical:
            continue
        if any(
            name and re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", answer, re.I)
            for name in (record.scientific_name, record.common_name, record.species_id)
        ):
            return None
    rendered = "\n\n".join([answer.strip(), *(c["content"] for c in protected)])
    return rendered, used + protected
