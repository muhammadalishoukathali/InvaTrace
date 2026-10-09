"""Store the server-derived land status on each event."""

import sqlalchemy as sa

from alembic import op

revision = "20261010_26"
down_revision = "20261009_25"
branch_labels = None
depends_on = None


def upgrade():
    # Hosts no longer self-declare land-manager permission; the API derives the
    # place's protected-area status and keeps it with the event. Existing rows
    # fail closed to "uncertain" until their next edit or publish re-checks them.
    op.add_column(
        "events",
        sa.Column("land_status", sa.String(16), nullable=False, server_default="uncertain"),
    )
    op.add_column("events", sa.Column("protected_area_name", sa.String(240), nullable=True))
    op.create_check_constraint(
        "land_status",
        "events",
        "land_status IN ('protected','not_protected','uncertain')",
    )


def downgrade():
    op.drop_constraint("ck_events_land_status", "events", type_="check")
    op.drop_column("events", "protected_area_name")
    op.drop_column("events", "land_status")
