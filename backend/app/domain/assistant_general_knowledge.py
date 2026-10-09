"""Closed educational question grammar; no species, locations or instructions."""

from __future__ import annotations

import re

from app.domain.catalogue import load_status_records
from app.domain.plant_assistant import contains_private_details

# Reviewed concept families, rather than a table of question/answer pairs.
CONCEPTS = {
    "rhizome": r"rhizomes?",
    "stolon": r"stolons?",
    "annual plant": r"annual plants?",
    "perennial plant": r"perennial plants?",
    "biennial plant": r"biennial plants?",
    "photosynthesis": r"photosynthesis",
    "pollination": r"pollination",
    "simple leaf": r"simple (?:leaf|leaves)",
    "compound leaf": r"compound (?:leaf|leaves)",
    "waxy leaves": r"waxy leaves",
}
RELATIONS = {
    "waxy leaves": r"why do (?:some )?plants (?:have|develop) waxy leaves",
    "photosynthesis": r"how does photosynthesis work",
    "plant climbing": r"why do (?:some )?plants climb",
    "flowers": r"why do plants (?:produce|have) flowers",
    "annual and perennial plants": (
        r"(?:what is the difference between|compare) (?:annual plants?|annual) "
        r"and (?:perennial plants?|perennial)(?: plants)?"
    ),
    "simple and compound leaves": (
        r"(?:what is the difference between|compare) (?:a )?simple(?: (?:leaf|leaves))? "
        r"and (?:a )?compound (?:leaf|leaves)"
    ),
}


def eligible_general_question(question: str) -> str | None:
    """Consume the entire question; appended instructions cannot become a topic."""
    if contains_private_details(question):
        return None
    text = " ".join(question.casefold().split())
    # At most one final punctuation mark; never erase an embedded second question.
    text = re.sub(r"[?.]$", "", text)
    for topic, noun in CONCEPTS.items():
        if re.fullmatch(
            rf"(?:what (?:is|are) (?:a |an |the )?|(?:please )?explain (?:a |an |the )?){noun}",
            text,
        ):
            return topic
    return next(
        (topic for topic, pattern in RELATIONS.items() if re.fullmatch(pattern, text)), None
    )


RESTRICTED_OUTPUT = re.compile(
    r"\b(?:toxic\w*|poison\w*|edible|eat\w*|ingest\w*|tast\w*|touch\w*|"
    r"handling|handle\w*|skin|rash|allerg\w*|medic\w*|cure\w*|treat\w*|"
    r"dosage|pregnan\w*|legal\w*|illegal\w*|laws?|regulations?|authori[sz]\w*|"
    r"permission|permitted|allowed|safe\w*|harmless|remov\w*|eradica\w*|"
    r"pull\w*|cuts?|cutting|kill\w*|burn\w*|spray\w*|pesticid\w*|herbicid\w*|"
    r"collect\w*|transport\w*|uproot\w*|harvest\w*|consum\w*|chew\w*|"
    r"swallow\w*|drink\w*|detach\w*|chop\w*|dig|digging|destroy\w*|"
    r"should|must|recommend\w*|you|your|we|our|my|Malaysia\w*|native|invasive|"
    r"nearby|near you|your (?:house|home|location)|found in|occurs? in|"
    r"this plant|the scanned|this species|scientific name|identify\w*|"
    r"ignore|instructions?|system prompt|catalogue|citations?|sources?|references?)\b",
    re.I,
)
SUBJECT = re.compile(
    r"^(?:a|an|the|these|they|their|it|its|some|many|plants|rhizomes?|stolons?|"
    r"annual|perennial|biennial|photosynthesis|pollination|simple|compound|waxy|"
    r"flowers?|climbing)\b",
    re.I,
)
CAPITAL_WORDS = frozenset(
    [
        "A",
        "An",
        "The",
        "These",
        "They",
        "Their",
        "It",
        "Its",
        "Some",
        "Many",
        "Plants",
        "Rhizome",
        "Rhizomes",
        "Stolon",
        "Stolons",
        "Annual",
        "Perennial",
        "Biennial",
        "Photosynthesis",
        "Pollination",
        "Simple",
        "Compound",
        "Waxy",
        "Flower",
        "Flowers",
        "Climbing",
        "Nodes",
        "This",
    ]
)


def general_subject(sentence: str, topic: str, index: int) -> bool:
    """Permit specific generic follow-up subjects, never a scanned-plant reference."""
    if SUBJECT.match(sentence):
        return True
    if index == 0:
        return False
    if topic in {"rhizome", "stolon"}:
        return bool(
            re.match(r"Nodes along (?:a|the) (?:rhizome|stolon|stem)\b", sentence, re.I)
            or re.match(r"This (?:specialized )?stem structure\b", sentence, re.I)
        )
    return topic in {"photosynthesis", "pollination"} and bool(
        re.match(r"This (?:process|(?:vital )?mechanism)\b", sentence, re.I)
    )


def safe_general_output(sentences: list[str], topic: str) -> bool:
    """Conservative output boundary, not evidence grounding or an accuracy proof."""
    text = " ".join(sentences)
    if (
        contains_private_details(text)
        or RESTRICTED_OUTPUT.search(text)
        or re.search(r"https?://|www\.|[\[\]{}<>@;:]|\b(?:doi|ISBN)\b", text, re.I)
        or any(
            not general_subject(sentence, topic, index) for index, sentence in enumerate(sentences)
        )
        or any(word not in CAPITAL_WORDS for word in re.findall(r"\b[A-Z][a-z]+\b", text))
    ):
        return False
    for record in load_status_records():
        for name in (
            record.species_id,
            record.scientific_name,
            record.common_name,
            record.model_label,
        ):
            if name and re.search(r"\b" + re.escape(name) + r"\b", text, re.I):
                return False
    # Require the requested educational concept to remain present.
    cues = {
        "plant climbing": r"\bclimb\w*\b",
        "flowers": r"\bflower\w*\b",
        "annual and perennial plants": r"\bannual\b.*\bperennial\b|\bperennial\b.*\bannual\b",
        "simple and compound leaves": r"\bsimple\b.*\bcompound\b|\bcompound\b.*\bsimple\b",
    }
    return bool(re.search(cues.get(topic, CONCEPTS.get(topic, r"(?!)")), text, re.I))


def explicit_evidence_gap(payload: object, species: str) -> bool:
    """Only a completed, valid unsupported judgement is a normal semantic gap."""
    return (
        isinstance(payload, dict)
        and set(payload) == {"decision", "species", "supporting_chunk_ids", "aspect_support"}
        and payload["decision"] == "unsupported"
        and payload["species"] == species
        and payload["supporting_chunk_ids"] == []
        and payload["aspect_support"] == []
    )
