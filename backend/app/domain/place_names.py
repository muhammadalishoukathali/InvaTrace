"""Human-facing place names and de-duplication for place search.

The OSM import keeps every feature, so it gives the second and later features
sharing a name a unique label such as ``"Ah Meng Trail · OSM way/123"``. That
label is right for storage but wrong for people: a split trail shows up as a
dozen near-identical rows, and a curated place appears again as its raw OSM
copy. Search lists use these helpers to show one clean entry per real place;
imported records take precedence over demonstration seed records.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

OSM_LABEL_SUFFIX = re.compile(r" · OSM (?:way|relation|node)/\d+$")
# Same-named features closer than this are treated as one place (a trail split
# into segments, or a park mapped as both a way and a relation).
SAME_PLACE_DISTANCE_KM = 3.0
# A curated place is a large, well-known site; its OSM copy's centre can sit
# further from the curated centre (Taman Botani Negara Shah Alam: 3.4 km).
CURATED_MATCH_DISTANCE_KM = 10.0


def public_place_name(name: str) -> str:
    """Drop the import's OSM-id disambiguator from a stored place name."""
    return OSM_LABEL_SUFFIX.sub("", name)


@dataclass
class PlaceCandidate[T]:
    item: T
    name: str
    kind: str  # "trail" or "area": a trail never merges with a park
    curated: bool
    suffixed: bool
    latitude: float | None
    longitude: float | None
    location_hint: str | None = None
    demo_seed: bool = False


def _distance_km(a: PlaceCandidate, b: PlaceCandidate) -> float:
    if None in (a.latitude, a.longitude, b.latitude, b.longitude):
        return 0.0  # no point to compare: assume it is the same place
    mean_lat = math.radians((a.latitude + b.latitude) / 2)  # type: ignore[operator]
    dx = (a.longitude - b.longitude) * 111.32 * math.cos(mean_lat)  # type: ignore[operator]
    dy = (a.latitude - b.latitude) * 110.57  # type: ignore[operator]
    return math.hypot(dx, dy)


def _hint(candidate: PlaceCandidate) -> str | None:
    if candidate.latitude is None or candidate.longitude is None:
        return None
    north_south = "N" if candidate.latitude >= 0 else "S"
    return f"Near {abs(candidate.latitude):.2f}° {north_south}, {candidate.longitude:.2f}° E"


def _root(parent: list[int], index: int) -> int:
    while parent[index] != index:
        parent[index] = parent[parent[index]]
        index = parent[index]
    return index


def dedupe_places[T](candidates: list[PlaceCandidate[T]]) -> list[PlaceCandidate[T]]:
    """One entry per real place; different places that share a name get a hint.

    Within a name and kind, candidates chained together by gaps shorter than
    SAME_PLACE_DISTANCE_KM merge into one (so every segment of a long split
    trail joins up), keeping a genuine curated place over OSM, OSM over demo seeds, and an unsuffixed OSM
    feature over a suffixed one. Clusters that remain apart are genuinely
    different places, so each gets an approximate-location hint.
    """
    groups: dict[tuple[str, str], list[PlaceCandidate[T]]] = {}
    for candidate in candidates:
        groups.setdefault((candidate.name.casefold(), candidate.kind), []).append(candidate)

    kept: list[PlaceCandidate[T]] = []
    for group in groups.values():
        parent = list(range(len(group)))

        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                limit = (
                    CURATED_MATCH_DISTANCE_KM
                    if group[i].curated or group[j].curated
                    else SAME_PLACE_DISTANCE_KM
                )
                if _distance_km(group[i], group[j]) < limit:
                    parent[_root(parent, i)] = _root(parent, j)
        clusters: dict[int, list[PlaceCandidate[T]]] = {}
        for index, candidate in enumerate(group):
            clusters.setdefault(_root(parent, index), []).append(candidate)
        representatives = [
            min(cluster, key=lambda c: (c.demo_seed, not c.curated, c.suffixed)) for cluster in clusters.values()
        ]
        if len(representatives) > 1:
            for rep in representatives:
                rep.location_hint = _hint(rep)
        kept.extend(representatives)
    return kept
