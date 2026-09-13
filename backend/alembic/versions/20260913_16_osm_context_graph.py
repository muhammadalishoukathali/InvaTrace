"""Persist OSM protected metadata and directed waterway topology.

Revision ID: 20260913_16
Revises: 20260913_15
"""

from __future__ import annotations

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260913_16"
down_revision = "20260913_15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("protected_areas", "name", existing_type=sa.String(240), nullable=True)
    op.add_column(
        "protected_areas",
        sa.Column(
            "metadata_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.alter_column("protected_areas", "metadata_json", server_default=None)

    op.create_table(
        "waterway_datasets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.String(200), nullable=False),
        sa.Column("version", sa.String(160), nullable=False),
        sa.Column("source_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sha256", sa.LargeBinary(32), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", "version", name="uq_waterway_source_version"),
    )
    op.create_index("ix_waterway_datasets_active", "waterway_datasets", ["active"])
    op.create_table(
        "waterway_edges",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("osm_way_id", sa.BigInteger(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("start_osm_node_id", sa.BigInteger(), nullable=False),
        sa.Column("end_osm_node_id", sa.BigInteger(), nullable=False),
        sa.Column("waterway_type", sa.String(20), nullable=False),
        sa.Column(
            "geometry",
            Geography("LINESTRING", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("length_m", sa.Numeric(12, 2), nullable=False),
        sa.Column("direction", sa.String(32), nullable=False),
        sa.CheckConstraint("length_m > 0", name="positive_length"),
        sa.CheckConstraint("direction = 'osm_way_order'", name="trusted_direction"),
        sa.ForeignKeyConstraint(["dataset_id"], ["waterway_datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dataset_id", "osm_way_id", "sequence", name="uq_waterway_edge"),
    )
    op.create_index("ix_waterway_edges_dataset_id", "waterway_edges", ["dataset_id"])
    op.create_index("ix_waterway_edges_start_osm_node_id", "waterway_edges", ["start_osm_node_id"])
    op.create_index("ix_waterway_edges_end_osm_node_id", "waterway_edges", ["end_osm_node_id"])
    op.create_index(
        "ix_waterway_edges_geometry_gist",
        "waterway_edges",
        ["geometry"],
        postgresql_using="gist",
    )

    for name, column in (
        ("occurrence_snap_distance_m", sa.Numeric(10, 2)),
        ("place_snap_distance_m", sa.Numeric(10, 2)),
        ("occurrence_osm_way_id", sa.BigInteger()),
        ("place_osm_way_id", sa.BigInteger()),
    ):
        op.add_column(
            "place_occurrence_waterway_evidence",
            sa.Column(name, column, nullable=False, server_default="0"),
        )
        op.alter_column("place_occurrence_waterway_evidence", name, server_default=None)


def downgrade() -> None:
    for name in (
        "place_osm_way_id",
        "occurrence_osm_way_id",
        "place_snap_distance_m",
        "occurrence_snap_distance_m",
    ):
        op.drop_column("place_occurrence_waterway_evidence", name)
    op.drop_index("ix_waterway_edges_geometry_gist", table_name="waterway_edges")
    op.drop_table("waterway_edges")
    op.drop_table("waterway_datasets")
    op.drop_column("protected_areas", "metadata_json")
    op.alter_column("protected_areas", "name", existing_type=sa.String(240), nullable=False)
