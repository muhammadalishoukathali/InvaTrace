"""Optional event association and authoritative capture timestamp."""

import sqlalchemy as sa

from alembic import op

revision = "20261002_22"
down_revision = "20261002_21"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("reports", sa.Column("event_id", sa.UUID(), nullable=True))
    op.add_column("reports", sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_reports_event_id_events", "reports", "events", ["event_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_reports_event_id", "reports", ["event_id"])


def downgrade():
    op.drop_index("ix_reports_event_id", table_name="reports")
    op.drop_constraint("fk_reports_event_id_events", "reports", type_="foreignkey")
    op.drop_column("reports", "captured_at")
    op.drop_column("reports", "event_id")
