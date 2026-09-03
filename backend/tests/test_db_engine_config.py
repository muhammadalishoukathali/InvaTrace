"""Regression test for the DB engine's pooler-safe configuration.

The deployed API sits behind a transaction-mode connection pooler
(PgBouncer / Render / Supabase shared pooler), which recycles the same
backend connection across logical sessions. psycopg3 auto-prepares every
query as ``_pg3_0`` / ``_pg3_1`` / …; if a prior checkout already
prepared ``_pg3_0`` on that backend, the next checkout's first query
crashes with::

    sqlalchemy.exc.ProgrammingError: (psycopg.errors.DuplicatePreparedStatement)
    prepared statement "_pg3_0" already exists

Disabling prepared statements at the driver (``prepare_threshold=None``)
is the standard fix. This test pins that setting so a future refactor
cannot silently re-introduce the boot-time crash the September 2026
Render deploys hit on the load-reference-data step.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_engine_disables_psycopg_prepared_statements() -> None:
    source = (REPO_ROOT / "app/db/base.py").read_text()
    assert '"prepare_threshold": None' in source, (
        "app/db/base.py must pass connect_args={'prepare_threshold': None}"
        " to create_engine so psycopg3 does not auto-prepare statements"
        " behind a transaction-mode pooler — otherwise the first query"
        " after a pooled-connection reuse crashes with"
        " DuplicatePreparedStatement '_pg3_0' already exists."
    )
    assert "connect_args=" in source
