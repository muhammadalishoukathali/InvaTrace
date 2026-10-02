"""Community events, anonymous participation, GPS check-ins and flags."""

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "20261002_21"
down_revision = "20261002_20"
branch_labels = None
depends_on = None


def point_column(name, lat="latitude", lon="longitude"):
    return sa.Column(
        name,
        Geography("POINT", srid=4326, spatial_index=False),
        sa.Computed(f"ST_SetSRID(ST_MakePoint({lon}, {lat}), 4326)::geography", persisted=True),
    )


def upgrade():
    op.create_table(
        "events",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "host_profile_id",
            sa.UUID(),
            sa.ForeignKey("profiles.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("place_id", sa.UUID(), nullable=False),
        sa.Column("place_type", sa.String(30), nullable=False),
        sa.Column("event_type", sa.String(20), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("target_species_ids", JSONB(), nullable=False),
        sa.Column("meeting_latitude", sa.Numeric(8, 5), nullable=False),
        sa.Column("meeting_longitude", sa.Numeric(8, 5), nullable=False),
        point_column("meeting_location", "meeting_latitude", "meeting_longitude"),
        sa.Column("meeting_note", sa.String(500)),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("safety_notes", sa.Text()),
        sa.Column("permission_context", sa.String(20), nullable=False),
        sa.Column("chat_link", sa.String(500)),
        sa.Column("capacity", sa.Integer()),
        sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("hidden_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("geometry_version", sa.String(160), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "event_type IN ('survey','removal','monitoring','other')", name="event_type"
        ),
        sa.CheckConstraint(
            "status IN ('draft','published','cancelled','completed')", name="status"
        ),
        sa.CheckConstraint(
            "permission_context IN ('unknown','explicit_permission')", name="permission_context"
        ),
        sa.CheckConstraint("end_at > start_at", name="time_range"),
        sa.CheckConstraint("meeting_latitude BETWEEN 0.8 AND 7.5", name="malaysia_latitude"),
        sa.CheckConstraint("meeting_longitude BETWEEN 99.3 AND 119.5", name="malaysia_longitude"),
        sa.CheckConstraint("capacity IS NULL OR capacity > 0", name="capacity"),
    )
    op.create_index("ix_events_host_profile_id", "events", ["host_profile_id"])
    op.create_index("ix_events_status_end_at", "events", ["status", "end_at"])
    op.create_index("ix_events_place_status", "events", ["place_id", "status"])
    op.create_index(
        "ix_events_meeting_location_gist", "events", ["meeting_location"], postgresql_using="gist"
    )
    op.create_table(
        "event_participants",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "event_id", sa.UUID(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "profile_id",
            sa.UUID(),
            sa.ForeignKey("profiles.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column(
            "joined_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("event_id", "profile_id", name="uq_event_participation"),
        sa.CheckConstraint("status IN ('joined','withdrawn')", name="status"),
    )
    op.create_index("ix_event_participants_event_id", "event_participants", ["event_id"])
    op.create_index("ix_event_participants_profile_id", "event_participants", ["profile_id"])
    op.create_table(
        "event_checkins",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "event_id", sa.UUID(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "profile_id",
            sa.UUID(),
            sa.ForeignKey("profiles.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("latitude", sa.Numeric(8, 5), nullable=False),
        sa.Column("longitude", sa.Numeric(8, 5), nullable=False),
        point_column("location"),
        sa.Column("accuracy_m", sa.Numeric(10, 3), nullable=False),
        sa.Column(
            "checked_in_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("accuracy_m BETWEEN 0 AND 250", name="accuracy_range"),
        sa.CheckConstraint("latitude BETWEEN 0.8 AND 7.5", name="malaysia_latitude"),
        sa.CheckConstraint("longitude BETWEEN 99.3 AND 119.5", name="malaysia_longitude"),
    )
    op.create_index("ix_event_checkins_event_profile", "event_checkins", ["event_id", "profile_id"])
    op.create_table(
        "event_flags",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "event_id", sa.UUID(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "reporter_profile_id",
            sa.UUID(),
            sa.ForeignKey("profiles.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("event_id", "reporter_profile_id", name="uq_event_flag_identity"),
    )
    op.create_index("ix_event_flags_event_id", "event_flags", ["event_id"])


def downgrade():
    for name in ("event_flags", "event_checkins", "event_participants", "events"):
        op.drop_table(name)
