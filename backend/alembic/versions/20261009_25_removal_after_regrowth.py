"""Allow a new removal report after confirmed regrowth."""

import sqlalchemy as sa

from alembic import op

revision = "20261009_25"
down_revision = "20261007_24"
branch_labels = None
depends_on = None


def upgrade():
    # Regrowth returns a sighting to active, so it can be removed again. The
    # sighting row lock in the removal endpoint keeps concurrent submissions
    # from recording two removals for the same active period.
    op.drop_index("uq_sighting_removal_event", table_name="sighting_status_events")


def downgrade():
    bind = op.get_bind()
    if bind.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM sighting_status_events WHERE event_type = 'removal_reported' GROUP BY sighting_id HAVING count(*) > 1)"
        )
    ):
        raise RuntimeError("A sighting has several removal reports; export them before downgrading.")
    op.create_index(
        "uq_sighting_removal_event",
        "sighting_status_events",
        ["sighting_id"],
        unique=True,
        postgresql_where=sa.text("event_type = 'removal_reported'"),
    )
