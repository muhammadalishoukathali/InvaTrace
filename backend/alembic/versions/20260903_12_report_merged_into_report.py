"""AC 2.3.2 — persist near-duplicate merge target as a self-reference on reports.

Adds ``merged_into_report_id`` on ``reports`` so a merged report points at the
retained report it was folded into. Nullable (non-merged reports leave it
unset) and ``ON DELETE SET NULL`` so deleting the retained report never
cascades away the merged one. Indexed for lookup by retained report id.

Revision ID: 20260903_12
Revises: 20260902_11
"""

from __future__ import annotations

from alembic import op


revision = "20260903_12"
down_revision = "20260902_11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE reports ADD COLUMN merged_into_report_id UUID")
    op.execute(
        "ALTER TABLE reports "
        "ADD CONSTRAINT fk_reports_merged_into_report_id "
        "FOREIGN KEY (merged_into_report_id) REFERENCES reports (id) ON DELETE SET NULL"
    )
    op.execute(
        "CREATE INDEX ix_reports_merged_into_report_id "
        "ON reports (merged_into_report_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_reports_merged_into_report_id")
    op.execute("ALTER TABLE reports DROP CONSTRAINT IF EXISTS fk_reports_merged_into_report_id")
    op.execute("ALTER TABLE reports DROP COLUMN IF EXISTS merged_into_report_id")
