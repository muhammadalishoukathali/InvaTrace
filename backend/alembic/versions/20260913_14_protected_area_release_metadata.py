"""Store auditable protected-area release metadata.

Revision ID: 20260913_14
Revises: 20260913_13
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260913_14"
down_revision = "20260913_13"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "protected_area_datasets",
        sa.Column(
            "metadata_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.alter_column("protected_area_datasets", "metadata_json", server_default=None)


def downgrade() -> None:
    op.drop_column("protected_area_datasets", "metadata_json")
