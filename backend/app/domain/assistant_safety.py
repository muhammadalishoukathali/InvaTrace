"""Closed, fully consumed intents for existing conditional safety paragraphs."""

from __future__ import annotations

import re

# Relations are checked against complete negative clauses, not isolated action
# words. Condition/object aliases apply only inside their respective relation.
PROHIBITIONS = (
    (
        "Do not pull vines through vegetation or leave stem fragments on moist soil.",
        r"leave (?:the |these |those )?stem (?:fragments|pieces) on (?:moist|damp) (?:soil|ground)",
    ),
    (
        "Do not pull vines through vegetation or leave stem fragments on moist soil.",
        r"pull (?:the |this )?(?:vines?|plant|it) through (?:the )?vegetation",
    ),
    (
        "Never enter water or return fragments to it;",
        r"(?:enter|go into) (?:the |a )?(?:water|pond|lake|river|stream)(?: to remove (?:it|this plant|the plant))?",
    ),
    (
        "Never enter water or return fragments to it;",
        r"(?:return (?:the )?(?:stem |plant )?fragments to|throw (?:the )?(?:broken |stem )?pieces back into) (?:the )?water",
    ),
    (
        "Do not move or break plants because small fragments can spread.",
        r"(?:move|break) (?:it|(?:the|this|these|those) (?:floating )?plants?|(?:the|this) floating mat)(?: apart)?",
    ),
    (
        "Do not cut or remove it without site permission.",
        r"(?:cut(?: down)?|remove) (?:it|this tree|the tree|this plant|the plant) without (?:site )?permission",
    ),
)
OBSERVATION_CLAUSES = (
    "Photograph, map and report the patch for authorised management.",
    "Photograph the leaves, bark and pods without disturbing the plant; record the location and report it.",
    "Stay on stable ground, photograph the mat and record the location.",
    "Keep a safe distance, avoid touching or smelling the plant, photograph it and report the exact point.",
    "Stay out of the water, photograph the leaf hairs and mat and report the waterbody.",
)


def observation_intent(question: str) -> bool:
    """Consume only benign context and an observation request, never unknown risk."""
    question = re.sub(
        r"^i found (?:it|this (?:plant|vine|tree)) (?:on (?:a|the) public path|in (?:a|the) park)[.;]\s*",
        "",
        question,
        count=1,
    )
    question = re.sub(
        r"^i (?:do not|don't) know (?:if|whether) i have (?:site )?permission\.\s*",
        "",
        question,
        count=1,
    )
    question = re.sub(
        r" (?:before (?:a|the) site manager responds|while (?:i wait|waiting) for (?:a|the) site manager|when (?:site )?permission is unknown)$",
        "",
        question,
        count=1,
    )
    return bool(
        re.fullmatch(
            r"(?:what (?:can|should) (?:i|we) do(?: safely| without disturbing (?:the plant|it))?(?: now| next)?|"
            r"what now|what (?:is|would be) (?:the )?(?:safe )?next step|"
            r"(?:can|could|may|should) (?:i|we) (?:photograph|take (?:a )?photos? of) "
            r"(?:it|this plant|the plant) without (?:disturbing|touching) (?:it|the plant))",
            question,
        )
    )


def parse_safety_intent(question: str) -> tuple[list[str], bool]:
    """Fully consumed grammar, independent of whether a species has evidence."""
    question = " ".join(question.casefold().replace("’", "'").split())
    question = re.sub(r"[.!?]+$", "", question).strip()
    if re.search(r"\d", question):
        return [], False
    action_request = re.fullmatch(r"(?:can|could|should|may|must) (?:i|we) (.+)", question)
    actions = re.split(r"\s+(?:and|or)\s+", action_request[1]) if action_request else []
    if not all(
        any(re.fullmatch(pattern, action) for _, pattern in PROHIBITIONS) for action in actions
    ):
        actions = []
    return actions, observation_intent(question)


def requests_bounded_safety(question: str) -> bool:
    """Route recognised intent to the existing safety topic boost, not an answer."""
    actions, observation = parse_safety_intent(question)
    return bool(actions or observation)


def supported_safety_evidence(species_id: str, question: str, candidates: list[dict]) -> list[dict]:
    """Match every requested relation against a complete existing source clause.

    Unknown tokens, methods, species, subquestions or condition inversions fail
    closed. General stemming and concept checks are unchanged.
    """
    actions, observation = parse_safety_intent(question)
    supported = []
    for chunk in candidates:
        if (
            chunk["species_id"] != species_id
            or chunk["topic"] != "safe_response"
            or chunk["score"] <= 0
        ):
            continue
        text = chunk["content"]
        prohibited = actions and all(
            any(
                clause in text and re.fullmatch(pattern, action) for clause, pattern in PROHIBITIONS
            )
            for action in actions
        )
        observable = observation and any(clause in text for clause in OBSERVATION_CLAUSES)
        if prohibited or observable:
            supported.append(chunk)
    return supported
