"""Regression tests for the exact-duplicate detection query.

AC Iteration 1 P4 - the router shortcut in `app/api/routers/reports.py`
must scope on species_id and return the *earliest* matching report, and
the worker's `_find_owner_species_replay` in `app/workers/verification.py`
must order by created_at ascending with a deterministic secondary key.

These asserts run against the source text rather than executing the query
so they do not need the backend Python environment or a live database to
verify. The intent is to fail loudly if a future refactor re-introduces
the `desc()` ordering or drops the species filter.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(relative: str) -> str:
    return (REPO_ROOT / relative).read_text()


def test_router_duplicate_lookup_scopes_on_species_and_orders_ascending() -> None:
    source = _read("app/api/routers/reports.py")
    # Extract the block guarded by screening_disable_duplicate_check so the
    # asserts do not accidentally match some other query in the file.
    marker = "if not get_settings().screening_disable_duplicate_check:"
    assert marker in source, "Duplicate-check guard block missing from router."
    block = source.split(marker, 1)[1].split("if duplicate is not None:", 1)[0]

    assert "Report.species_id == body.species_id" in block, (
        "Router duplicate check must filter on species_id - otherwise the"
        " same photo classified as a different species is swallowed as a replay."
    )
    assert "Report.created_at.asc()" in block, (
        "Router duplicate check must order ascending so the earliest anchor"
        " report is returned, not a later merged/rejected shim."
    )
    assert "Report.id.asc()" in block, (
        "Secondary id ordering keeps the lookup deterministic across ties."
    )
    assert ".desc()" not in block, (
        "Descending ordering would surface the newest chained duplicate"
        " instead of the original anchor report."
    )


def test_worker_owner_species_replay_orders_ascending() -> None:
    source = _read("app/workers/verification.py")
    marker = "def _find_owner_species_replay("
    assert marker in source, "_find_owner_species_replay helper missing."
    # Isolate the function body up to the next top-level `def` so the assert
    # only inspects the one query we care about.
    body = source.split(marker, 1)[1].split("\ndef ", 1)[0]

    assert "Report.created_at.asc()" in body, (
        "Worker replay lookup must order created_at ascending so concurrent"
        " screeners for the same photo resolve to a single deterministic anchor."
    )
    assert "Report.id.asc()" in body, (
        "Secondary id ordering keeps the anchor stable when two priors share"
        " a created_at timestamp."
    )
