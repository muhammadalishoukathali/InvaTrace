"""AC 4.3.1 - persist nearest OSM feature on each sighting.

Adds ``nearest_feature_type`` / ``nearest_feature_name`` /
``nearest_feature_distance_m`` on ``sightings`` so the server-side lookup
result is authoritative, backed by the imported OSM-derived tables. Kept
nullable because a sighting outside the 5 km search radius still publishes
cleanly with those columns unset.

Revision ID: 20260902_11
Revises: 20260902_10
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op


revision = "20260902_11"
down_revision = "20260902_10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sightings", sa.Column("nearest_feature_type", sa.String(length=30), nullable=True))
    op.add_column("sightings", sa.Column("nearest_feature_name", sa.String(length=200), nullable=True))
    op.add_column("sightings", sa.Column("nearest_feature_distance_m", sa.Numeric(8, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("sightings", "nearest_feature_distance_m")
    op.drop_column("sightings", "nearest_feature_name")
    op.drop_column("sightings", "nearest_feature_type")
