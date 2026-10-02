"""Relax removal-report accuracy and distance limits to 350 m.

Revision ID: 20261002_20
Revises: 20260923_19
"""

from __future__ import annotations

from alembic import op

revision = "20261002_20"
down_revision = "20260923_19"
branch_labels = None
depends_on = None

TABLE = "sighting_status_events"


def _set_limit(limit: int, *, validate: bool = True) -> None:
    for column in ("accuracy", "distance"):
        name = f"ck_{TABLE}_{column}_range"
        op.execute(f"ALTER TABLE {TABLE} DROP CONSTRAINT {name}")
        op.execute(
            f"ALTER TABLE {TABLE} ADD CONSTRAINT {name} CHECK ({column}_m BETWEEN 0 AND {limit})"
            + ("" if validate else " NOT VALID")
        )


def upgrade() -> None:
    _set_limit(350)


def downgrade() -> None:
    # NOT VALID keeps rows recorded between 250 and 350 m instead of failing.
    _set_limit(250, validate=False)
