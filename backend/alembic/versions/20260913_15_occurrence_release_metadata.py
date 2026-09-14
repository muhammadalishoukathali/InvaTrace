"""Preserve record-level occurrence provenance.

Revision ID: 20260913_15
Revises: 20260913_14
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260913_15"
down_revision = "20260913_14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "occurrence_records",
        sa.Column(
            "metadata_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.alter_column("occurrence_records", "metadata_json", server_default=None)


def downgrade() -> None:
    op.drop_column("occurrence_records", "metadata_json")
