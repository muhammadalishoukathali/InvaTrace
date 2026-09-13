"""Tests for app.domain.place_association.

Covers AC 4.3.1 categorisation (only path/footway/track/park/forest/wood
count) and AC 4.3.2 fallback (no match → None so the sheet renders "No
named trail, park or forest found nearby").
"""

from __future__ import annotations

from app.domain.place_association import (
    _AREA_CATEGORIES,
    _TRAIL_CATEGORIES,
    NearestOsmFeature,
    _categorise,
)


def test_trail_categories_are_the_expected_allow_list() -> None:
    assert {"path", "footway", "track"} == _TRAIL_CATEGORIES


def test_area_categories_are_the_expected_allow_list() -> None:
    assert {"park", "forest", "wood"} == _AREA_CATEGORIES


def test_categorise_picks_direct_highway_tag() -> None:
    assert _categorise({"highway": "path"}, _TRAIL_CATEGORIES) == "path"
    assert _categorise({"highway": "footway"}, _TRAIL_CATEGORIES) == "footway"


def test_categorise_picks_direct_area_tag() -> None:
    assert _categorise({"leisure": "park"}, _AREA_CATEGORIES) == "park"
    assert _categorise({"natural": "wood"}, _AREA_CATEGORIES) == "wood"
    assert _categorise({"landuse": "forest"}, _AREA_CATEGORIES) == "forest"


def test_categorise_reads_nested_tags_dict() -> None:
    assert _categorise({"tags": {"highway": "track"}}, _TRAIL_CATEGORIES) == "track"


def test_categorise_rejects_non_allow_listed_values() -> None:
    # AC 4.3.1 - roads, farmland, water etc. must not be surfaced as nearest
    # features even when the imported OSM record has them tagged.
    assert _categorise({"highway": "motorway"}, _TRAIL_CATEGORIES) is None
    assert _categorise({"landuse": "farmland"}, _AREA_CATEGORIES) is None
    assert _categorise({}, _TRAIL_CATEGORIES) is None


def test_nearest_osm_feature_is_hashable_dataclass() -> None:
    # NearestOsmFeature is what the worker persists onto Sighting rows; make
    # sure it serialises to the round values the API contract expects.
    feature = NearestOsmFeature("park", "Bukit Kiara", 42.5)
    assert feature.feature_type == "park"
    assert feature.distance_m == 42.5
