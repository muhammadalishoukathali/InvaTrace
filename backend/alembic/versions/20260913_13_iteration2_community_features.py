"""Iteration 2 protected context, occurrences, removal history and adoptions.

Revision ID: 20260913_13
Revises: 20260903_12
"""

from __future__ import annotations

import sqlalchemy as sa
from geoalchemy2 import Geography

from alembic import op

revision = "20260913_13"
down_revision = "20260903_12"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "protected_area_datasets",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source", sa.String(200), nullable=False),
        sa.Column("version", sa.String(120), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("coverage_note", sa.String(500), nullable=False),
        sa.Column(
            "coverage_geometry",
            Geography("MULTIPOLYGON", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", "version", name="uq_boundary_source_version"),
    )
    op.create_index("ix_protected_area_datasets_active", "protected_area_datasets", ["active"])
    op.create_index(
        "ix_protected_area_datasets_coverage_gist",
        "protected_area_datasets",
        ["coverage_geometry"],
        postgresql_using="gist",
    )
    op.create_table(
        "protected_areas",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("dataset_id", sa.UUID(), nullable=False),
        sa.Column("source_feature_id", sa.String(160), nullable=False),
        sa.Column("name", sa.String(240), nullable=False),
        sa.Column(
            "geometry",
            Geography("MULTIPOLYGON", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["dataset_id"], ["protected_area_datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dataset_id", "source_feature_id", name="uq_boundary_dataset_feature"),
    )
    op.create_index("ix_protected_areas_dataset_id", "protected_areas", ["dataset_id"])
    op.create_index(
        "ix_protected_areas_geometry_gist", "protected_areas", ["geometry"], postgresql_using="gist"
    )

    op.create_table(
        "occurrence_records",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source", sa.String(120), nullable=False),
        sa.Column("source_occurrence_id", sa.String(240), nullable=False),
        sa.Column("species_id", sa.String(80), nullable=False),
        sa.Column("latitude", sa.Numeric(8, 5), nullable=False),
        sa.Column("longitude", sa.Numeric(8, 5), nullable=False),
        sa.Column(
            "location",
            Geography("POINT", srid=4326, spatial_index=False),
            sa.Computed(
                "ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography",
                persisted=True,
            ),
        ),
        sa.Column("country_code", sa.String(2), nullable=False, server_default="MY"),
        sa.Column("occurrence_status", sa.String(20), nullable=False, server_default="Present"),
        sa.Column("coordinate_uncertainty_m", sa.Integer(), nullable=False),
        sa.Column("observed_year", sa.Integer()),
        sa.Column("processed_data_version", sa.String(120), nullable=False),
        sa.Column(
            "imported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("country_code = 'MY'", name="malaysia_only"),
        sa.CheckConstraint(
            "occurrence_status = 'Present'", name="present_only"
        ),
        sa.CheckConstraint(
            "coordinate_uncertainty_m BETWEEN 0 AND 1000",
            name="max_uncertainty",
        ),
        sa.CheckConstraint(
            "latitude BETWEEN 0.8 AND 7.5", name="malaysia_latitude"
        ),
        sa.CheckConstraint(
            "longitude BETWEEN 99.3 AND 119.5", name="malaysia_longitude"
        ),
        sa.ForeignKeyConstraint(["species_id"], ["species.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", "source_occurrence_id", name="uq_occurrence_source_id"),
    )
    op.create_index("ix_occurrence_records_species_id", "occurrence_records", ["species_id"])
    op.create_index(
        "ix_occurrence_records_location_gist",
        "occurrence_records",
        ["location"],
        postgresql_using="gist",
    )

    op.create_table(
        "place_occurrence_waterway_evidence",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("place_type", sa.String(20), nullable=False),
        sa.Column("place_id", sa.UUID(), nullable=False),
        sa.Column("occurrence_id", sa.UUID(), nullable=False),
        sa.Column("waterway_network_id", sa.String(160), nullable=False),
        sa.Column("upstream_distance_m", sa.Numeric(10, 2), nullable=False),
        sa.Column("direction_source", sa.String(200), nullable=False),
        sa.Column("data_version", sa.String(120), nullable=False),
        sa.Column(
            "imported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "place_type IN ('park','forest','wood','trail')",
            name="place_type",
        ),
        sa.CheckConstraint(
            "upstream_distance_m BETWEEN 0 AND 5000",
            name="distance_range",
        ),
        sa.ForeignKeyConstraint(
            ["occurrence_id"], ["occurrence_records.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "place_type",
            "place_id",
            "occurrence_id",
            "waterway_network_id",
            name="uq_place_occurrence_waterway",
        ),
    )
    op.create_index(
        "ix_place_occurrence_waterway_evidence_place_id",
        "place_occurrence_waterway_evidence",
        ["place_id"],
    )
    op.create_index(
        "ix_place_occurrence_waterway_evidence_occurrence_id",
        "place_occurrence_waterway_evidence",
        ["occurrence_id"],
    )

    op.create_table(
        "adopted_areas",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("place_type", sa.String(20), nullable=False),
        sa.Column("place_id", sa.UUID(), nullable=False),
        sa.Column("geometry_version", sa.String(120), nullable=False),
        sa.Column(
            "geometry",
            Geography("GEOMETRY", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column(
            "adopted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "place_type IN ('park','forest','wood','trail')",
            name="place_type",
        ),
        sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("profile_id", "place_id", name="uq_profile_place_adoption"),
    )
    op.create_index("ix_adopted_areas_profile_id", "adopted_areas", ["profile_id"])
    op.create_index("ix_adopted_areas_place_id", "adopted_areas", ["place_id"])
    op.create_index(
        "ix_adopted_areas_geometry_gist", "adopted_areas", ["geometry"], postgresql_using="gist"
    )

    op.create_table(
        "sighting_status_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("sighting_id", sa.UUID(), nullable=False),
        sa.Column("report_id", sa.UUID(), nullable=False),
        sa.Column("acting_profile_id", sa.UUID()),
        sa.Column("event_type", sa.String(30), nullable=False),
        sa.Column("latitude", sa.Numeric(8, 5), nullable=False),
        sa.Column("longitude", sa.Numeric(8, 5), nullable=False),
        sa.Column("accuracy_m", sa.Numeric(10, 3), nullable=False),
        sa.Column("distance_m", sa.Numeric(8, 2), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "event_type IN ('removal_reported')", name="event_type"
        ),
        sa.CheckConstraint(
            "accuracy_m BETWEEN 0 AND 250", name="accuracy_range"
        ),
        sa.CheckConstraint(
            "distance_m BETWEEN 0 AND 250", name="distance_range"
        ),
        sa.CheckConstraint(
            "latitude BETWEEN 0.8 AND 7.5",
            name="malaysia_latitude",
        ),
        sa.CheckConstraint(
            "longitude BETWEEN 99.3 AND 119.5",
            name="malaysia_longitude",
        ),
        sa.ForeignKeyConstraint(["sighting_id"], ["sightings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["report_id"], ["reports.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["acting_profile_id"], ["profiles.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sighting_id", "event_type", name="uq_sighting_status_event"),
    )
    op.create_index(
        "ix_sighting_status_events_sighting_id", "sighting_status_events", ["sighting_id"]
    )
    op.create_index("ix_sighting_status_events_report_id", "sighting_status_events", ["report_id"])
    op.create_index(
        "ix_sighting_status_events_acting_profile_id",
        "sighting_status_events",
        ["acting_profile_id"],
    )

    op.execute("ALTER TABLE sightings DROP CONSTRAINT ck_sightings_status")
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT ck_sightings_status CHECK "
        "(status IN ('candidate','screened','rejected','removed','removal_reported','merged'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE sightings DROP CONSTRAINT ck_sightings_status")
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT ck_sightings_status CHECK "
        "(status IN ('candidate','screened','rejected','removed','merged'))"
    )
    op.drop_table("sighting_status_events")
    op.drop_table("adopted_areas")
    op.drop_table("place_occurrence_waterway_evidence")
    op.drop_table("occurrence_records")
    op.drop_table("protected_areas")
    op.drop_table("protected_area_datasets")
