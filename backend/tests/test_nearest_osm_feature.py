"""Regression tests for the OSM nearest-feature lookup.

AC Iteration 1 P10 - the importer must persist the OSM tag pair that
matched (leisure/park, landuse/forest, natural/wood for areas; highway
value for trails) into metadata_json, and the categoriser must recognise
that metadata so `nearest_osm_feature` can actually return a value.

Two prior bugs are pinned here:

  1. Importer only stored generic `"osmType": "area"` / `"way"`, giving
     `_categorise` no tag to check → `nearest_osm_feature` returned None
     for every point, and every sighting stored null for
     nearest_feature_*. The AC 4.3.2 "No named trail, park or forest
     found nearby" copy would surface even when a real park sat 200 m
     away.
  2. `nearest_osm_feature` LIMITed to 1 candidate per table. A nearer
     non-allow-listed row (e.g. a nature_reserve area) short-circuited
     the lookup and prevented a further-away park from ever being
     returned.
"""

from __future__ import annotations

import ast
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_categorise():
    """Exec just the `_categorise` function and the constants it consults,
    avoiding the module's geoalchemy2 / SQLAlchemy imports which are not
    available in the offline test environment."""
    source = (REPO_ROOT / "app/domain/place_association.py").read_text()
    tree = ast.parse(source)
    wanted_names = {"_TRAIL_CATEGORIES", "_AREA_CATEGORIES"}
    wanted_funcs = {"_categorise"}
    extracted: list[ast.stmt] = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id in wanted_names
            for target in node.targets
        ):
            extracted.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in wanted_funcs:
            extracted.append(node)
    module_ast = ast.Module(body=extracted, type_ignores=[])
    namespace: dict[str, object] = {}
    exec(compile(module_ast, "place_association_extract", "exec"), namespace)
    return namespace


def test_importer_area_stores_matched_osm_tag_pair() -> None:
    source = (REPO_ROOT / "app/osm_import.py").read_text()
    area_body = source.split("def area(", 1)[1].split("\n    def ", 1)[0]
    assert "matched_tag = next(" in area_body, (
        "The importer must remember which allow-listed AREA_TAGS pair matched,"
        " not just that the row was some kind of area."
    )
    assert "tag_key, tag_value = matched_tag" in area_body
    assert "tag_key: tag_value" in area_body, (
        "metadata_json must include the matched key/value so"
        " place_association._categorise can classify the row later."
    )


def test_importer_way_stores_highway_tag_value() -> None:
    source = (REPO_ROOT / "app/osm_import.py").read_text()
    way_body = source.split("def way(", 1)[1].split("\n    def ", 1)[0]
    assert '"highway": tags.get("highway")' in way_body, (
        "The importer must persist the OSM `highway` tag value on Trail rows"
        " so nearest_osm_feature can filter to the path/footway/track allow-list."
    )


def test_categorise_recognises_the_importer_metadata_shape() -> None:
    ns = _load_categorise()
    categorise = ns["_categorise"]
    area_categories = ns["_AREA_CATEGORIES"]
    trail_categories = ns["_TRAIL_CATEGORIES"]
    assert categorise({"leisure": "park"}, area_categories) == "park"
    assert categorise({"landuse": "forest"}, area_categories) == "forest"
    assert categorise({"natural": "wood"}, area_categories) == "wood"
    assert categorise({"highway": "path"}, trail_categories) == "path"
    assert categorise({"highway": "footway"}, trail_categories) == "footway"
    assert categorise({"highway": "track"}, trail_categories) == "track"
    # Non-allow-listed values must not smuggle through as generic "type".
    assert categorise({"leisure": "nature_reserve"}, area_categories) is None
    assert categorise({"boundary": "national_park"}, area_categories) is None
    # A row from the old importer format (no tag key at all) must be
    # classified as unknown so the caller falls through to the next candidate.
    assert categorise({"osmType": "area", "osmId": "123"}, area_categories) is None


def test_nearest_lookup_iterates_multiple_candidates_per_table() -> None:
    source = (REPO_ROOT / "app/domain/place_association.py").read_text()
    assert "_NEAREST_CANDIDATE_LIMIT" in source, (
        "A candidate limit constant must exist so a non-allow-listed nearest"
        " row cannot silently mask a further-away allow-listed one."
    )
    for func_name, table_name in (("trail_rows", "Trail"), ("area_rows", "MonitoredArea")):
        assert f"{func_name} = session.execute(" in source, (
            f"{table_name} lookup must fetch multiple rows and iterate."
        )
    assert source.count(".limit(_NEAREST_CANDIDATE_LIMIT)") == 2, (
        "Both the trail and the area queries must use the shared candidate limit."
    )
    # The break-on-first-categorised pattern proves iteration ends at the
    # closest allow-listed row, not the closest row overall.
    trail_iter = source.split("trail_rows = session.execute(", 1)[1].split("area_rows", 1)[0]
    assert "for row in trail_rows:" in trail_iter
    assert "break" in trail_iter
