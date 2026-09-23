"""Allow a 'withdrawn' sighting status.

UT-10 lets a reporter withdraw an accidental *published* report. The backing
sighting is flagged 'withdrawn' so it leaves the public map while the report row
and audit trail are preserved. That new status value has to be permitted by the
sightings status check constraint.

Revision ID: 20260923_19
Revises: 20260914_18
"""

from __future__ import annotations

from alembic import op

revision = "20260923_19"
down_revision = "20260914_18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE sightings DROP CONSTRAINT ck_sightings_status")
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT ck_sightings_status CHECK "
        "(status IN ('candidate','screened','rejected','removed',"
        "'removal_reported','merged','withdrawn'))"
    )


def downgrade() -> None:
    # Fold any withdrawn rows back to 'rejected' so the tighter constraint can
    # re-apply without failing on an out-of-range value.
    op.execute("UPDATE sightings SET status = 'rejected' WHERE status = 'withdrawn'")
    op.execute("ALTER TABLE sightings DROP CONSTRAINT ck_sightings_status")
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT ck_sightings_status CHECK "
        "(status IN ('candidate','screened','rejected','removed',"
        "'removal_reported','merged'))"
    )
