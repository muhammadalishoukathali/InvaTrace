"""Append-only follow-up attempts and derived map states."""

import sqlalchemy as sa

from alembic import op

revision = "20261002_23"
down_revision = "20261002_22"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("sightings", "status", type_=sa.String(30), existing_type=sa.String(20))
    op.execute("ALTER TABLE sightings DROP CONSTRAINT ck_sightings_status")
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT ck_sightings_status CHECK (status IN ('candidate','screened','rejected','removed','removal_reported','merged','withdrawn','resolved_after_follow_up'))"
    )
    op.add_column("sightings", sa.Column("follow_up_state", sa.String(30)))
    op.add_column("sightings", sa.Column("last_followup_at", sa.DateTime(timezone=True)))
    op.create_index("ix_sightings_follow_up_state", "sightings", ["follow_up_state"])
    op.execute("UPDATE sightings SET follow_up_state='needed' WHERE status='removal_reported'")
    op.execute(
        "ALTER TABLE sighting_status_events DROP CONSTRAINT ck_sighting_status_events_event_type"
    )
    op.execute(
        "ALTER TABLE sighting_status_events ADD CONSTRAINT ck_sighting_status_events_event_type CHECK (event_type IN ('removal_reported','followup_no_regrowth','followup_regrowth','followup_unable'))"
    )
    op.drop_constraint("uq_sighting_status_event", "sighting_status_events", type_="unique")
    op.alter_column("sighting_status_events", "report_id", nullable=True)
    op.create_check_constraint(
        "followup_location_range",
        "sighting_status_events",
        "event_type = 'removal_reported' OR (accuracy_m <= 250 AND distance_m <= 250)",
    )
    op.create_index(
        "ix_sighting_status_history",
        "sighting_status_events",
        ["sighting_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "uq_sighting_removal_event",
        "sighting_status_events",
        ["sighting_id"],
        unique=True,
        postgresql_where=sa.text("event_type = 'removal_reported'"),
    )


def downgrade():
    # Downgrading populated history must be deliberate; do not erase attempts.
    bind = op.get_bind()
    if bind.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM sighting_status_events WHERE event_type <> 'removal_reported') OR EXISTS (SELECT 1 FROM sightings WHERE status = 'resolved_after_follow_up')"
        )
    ):
        raise RuntimeError("Follow-up history exists; export and migrate it before downgrading.")
    op.drop_index("uq_sighting_removal_event", table_name="sighting_status_events")
    op.drop_index("ix_sighting_status_history", table_name="sighting_status_events")
    op.drop_constraint(
        op.f("ck_sighting_status_events_followup_location_range"),
        "sighting_status_events",
        type_="check",
    )
    op.alter_column("sighting_status_events", "report_id", nullable=False)
    op.create_unique_constraint(
        "uq_sighting_status_event", "sighting_status_events", ["sighting_id", "event_type"]
    )
    op.execute(
        "ALTER TABLE sighting_status_events DROP CONSTRAINT ck_sighting_status_events_event_type"
    )
    op.execute(
        "ALTER TABLE sighting_status_events ADD CONSTRAINT ck_sighting_status_events_event_type CHECK (event_type IN ('removal_reported'))"
    )
    op.drop_index("ix_sightings_follow_up_state", table_name="sightings")
    op.drop_column("sightings", "last_followup_at")
    op.drop_column("sightings", "follow_up_state")
    op.execute("ALTER TABLE sightings DROP CONSTRAINT ck_sightings_status")
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT ck_sightings_status CHECK (status IN ('candidate','screened','rejected','removed','removal_reported','merged','withdrawn'))"
    )
    op.alter_column("sightings", "status", type_=sa.String(20), existing_type=sa.String(30))
