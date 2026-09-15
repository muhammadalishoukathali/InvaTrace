"""Iteration-2 §3 dispersal-trait invariants.

The approved catalogue may treat a species as water-dispersed only when:
  * ``water`` is present in ``dispersal_modes``,
  * at least one referenced source explicitly states water, floodwater,
    downstream or water-current dispersal,
  * the source URL, title, publisher and access/review date are retained,
  * the species remains in the approved 32-species catalogue.

Urochloa mutica must not be direction-eligible under current evidence.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domain.catalogue import CatalogueError, load_approved_species

CATALOGUE_PATH = (
    Path(__file__).resolve().parents[2] / "shared" / "catalogue" / "approved-species.json"
)


@pytest.fixture(scope="module")
def raw_catalogue() -> dict:
    return json.loads(CATALOGUE_PATH.read_text(encoding="utf-8"))


def test_catalogue_still_contains_exactly_thirty_two_records(raw_catalogue: dict) -> None:
    assert raw_catalogue["record_count"] == 32
    assert len(raw_catalogue["records"]) == 32


def test_every_water_dispersed_species_carries_a_sourced_trait() -> None:
    records = load_approved_species()
    water_ids = {record.species_id for record in records if record.water_dispersed}
    # Iteration 2 must include the three legacy species plus the five newly
    # sourced candidates. Urochloa mutica is deliberately excluded.
    expected_water_ids = {
        "eichhornia-crassipes",
        "limnocharis-flava",
        "salvinia-molesta",
        "mimosa-pigra",
        "parthenium-hysterophorus",
        "mikania-micrantha",
        "chromolaena-odorata",
        "cyperus-rotundus",
    }
    assert water_ids == expected_water_ids
    for record in records:
        if record.water_dispersed:
            assert "water" in record.dispersal_modes, record.species_id
            assert record.dispersal_source_ids, record.species_id
            assert record.dispersal_reviewed_at is not None, record.species_id
            assert record.water_dispersed_sourced, record.species_id


def test_urochloa_mutica_is_never_direction_eligible() -> None:
    records = {record.species_id: record for record in load_approved_species()}
    urochloa = records["urochloa-mutica"]
    assert urochloa.water_dispersed is False
    assert urochloa.dispersal_modes == ()
    assert urochloa.water_dispersed_sourced is False


def test_every_dispersal_source_resolves_and_has_full_provenance(raw_catalogue: dict) -> None:
    sources_by_id = {source["source_id"]: source for source in raw_catalogue["sources"]}
    for record in raw_catalogue["records"]:
        for source_id in record.get("dispersal_source_ids") or ():
            source = sources_by_id.get(source_id)
            assert source is not None, f"Missing dispersal source: {source_id}"
            for field in ("title", "publisher", "url", "accessed"):
                assert source.get(field), f"Source {source_id} missing {field}"


def test_loader_rejects_water_dispersed_true_without_sourced_water(tmp_path: Path) -> None:
    """Any future edit that flips ``water_dispersed`` on without sources fails.

    The loader is authoritative even when JSON Schema validation is
    skipped (mocks, seed data, integration harnesses). This protects the
    downstream direction-aware pipeline from unsourced dispersal claims.
    """
    payload = json.loads(CATALOGUE_PATH.read_text(encoding="utf-8"))
    # Mutate one non-water species in place, then reload.
    target = next(
        record
        for record in payload["records"]
        if record["species_id"] == "acacia-mangium"
    )
    target["water_dispersed"] = True
    corrupted = tmp_path / "approved-species.json"
    corrupted.write_text(json.dumps(payload), encoding="utf-8")
    # Point the loader at the corrupted file for one call by patching the
    # module-level path constant. We restore it in the fixture teardown.
    from app.domain import catalogue as catalogue_module

    catalogue_module.load_approved_species.cache_clear()
    original = catalogue_module.APPROVED_SPECIES_PATH
    try:
        catalogue_module.APPROVED_SPECIES_PATH = corrupted
        with pytest.raises(CatalogueError, match="sourced 'water' entry"):
            load_approved_species()
    finally:
        catalogue_module.APPROVED_SPECIES_PATH = original
        catalogue_module.load_approved_species.cache_clear()
