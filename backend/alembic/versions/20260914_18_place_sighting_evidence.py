"""Iteration-2 §4 place_sighting_evidence table.

Community sightings now contribute a separately labelled evidence tier
to place-association responses. The reviewed historical GBIF evidence
must not be merged with community reports; this table keeps community
associations auditable and idempotent per calculation version so retries
after a verification-worker restart do not duplicate rows.

Revision ID: 20260914_18
Revises: 20260914_17
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260914_18"
down_revision = "20260914_17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "place_sighting_evidence",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("place_type", sa.String(20), nullable=False),
        sa.Column("place_id", sa.UUID(), nullable=False),
        sa.Column("sighting_id", sa.UUID(), nullable=False),
        sa.Column("species_id", sa.String(80), nullable=False),
        sa.Column("relation_type", sa.String(30), nullable=False),
        sa.Column("straight_line_distance_m", sa.Numeric(10, 2), nullable=True),
        sa.Column("upstream_distance_m", sa.Numeric(10, 2), nullable=True),
        sa.Column("occurrence_snap_distance_m", sa.Numeric(10, 2), nullable=True),
        sa.Column("place_snap_distance_m", sa.Numeric(10, 2), nullable=True),
        sa.Column("waterway_dataset_id", sa.UUID(), nullable=True),
        sa.Column("geometry_version", sa.String(160), nullable=False),
        sa.Column("calculation_version", sa.String(160), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["sighting_id"], ["sightings.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "place_type IN ('park','forest','wood','trail')",
            name="place_sighting_evidence_place_type",
        ),
        sa.CheckConstraint(
            "relation_type IN ('inside_boundary','nearby_buffer','upstream_waterway')",
            name="place_sighting_evidence_relation_type",
        ),
        sa.PrimaryKeyConstraint("id"),
        # Idempotency: retries of the same (sighting, place, relation, calc
        # version) never duplicate a row. The verification worker can safely
        # re-drive the association-refresh job.
        sa.UniqueConstraint(
            "sighting_id",
            "place_id",
            "relation_type",
            "calculation_version",
            name="uq_place_sighting_evidence",
        ),
    )
    op.create_index(
        "ix_place_sighting_evidence_place",
        "place_sighting_evidence",
        ["place_id", "place_type"],
    )
    op.create_index(
        "ix_place_sighting_evidence_species",
        "place_sighting_evidence",
        ["species_id"],
    )
    op.create_index(
        "ix_place_sighting_evidence_sighting",
        "place_sighting_evidence",
        ["sighting_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_place_sighting_evidence_sighting", table_name="place_sighting_evidence")
    op.drop_index("ix_place_sighting_evidence_species", table_name="place_sighting_evidence")
    op.drop_index("ix_place_sighting_evidence_place", table_name="place_sighting_evidence")
    op.drop_table("place_sighting_evidence")
