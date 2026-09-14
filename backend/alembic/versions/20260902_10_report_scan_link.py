"""AC 2.2.1 - link every report to its originating scan.

Adds ``reports.scan_id`` as a non-null foreign key to ``scans.id``. Existing
``reports`` rows are backfilled to whatever scan shares their (profile_id,
capture_id) pair; any report that has no such scan (legacy fire-and-forget
period before this remediation) is deleted rather than left orphaned, since
without a scan the report cannot pass the AC 2.2.1 consistency gates. The
column is then flipped to NOT NULL and indexed.

Revision ID: 20260902_10
Revises: 20260902_09
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260902_10"
down_revision = "20260902_09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # AC 2.2.1 - persist the capture source on the scan too, so the report's
    # capture_source can be verified against what the client sent at
    # classification time.
    op.add_column(
        "scans",
        sa.Column("capture_source", sa.String(length=20), nullable=True),
    )
    op.create_check_constraint(
        "scan_capture_source",
        "scans",
        "capture_source IS NULL OR capture_source IN ('camera','gallery')",
    )
    op.add_column(
        "reports",
        sa.Column(
            "scan_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("scans.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    # Backfill: match the scan on (profile_id, capture_id). Reports whose scan
    # never persisted (offline queue submitted before the scan endpoint went
    # live) are removed together with their verification jobs and links so the
    # NOT NULL constraint below is applicable.
    op.execute(
        """
        UPDATE reports r
        SET scan_id = s.id
        FROM scans s
        WHERE s.profile_id = r.profile_id
          AND s.capture_id = r.capture_id
          AND r.scan_id IS NULL
        """
    )
    op.execute(
        """
        DELETE FROM report_sighting_links
        WHERE report_id IN (SELECT id FROM reports WHERE scan_id IS NULL)
        """
    )
    op.execute(
        """
        DELETE FROM verification_jobs
        WHERE report_id IN (SELECT id FROM reports WHERE scan_id IS NULL)
        """
    )
    # Older seeds recorded automated_validation_decisions and audit events
    # against reports before the scan endpoint existed. Clean those up so
    # the legacy-report DELETE below does not trip a foreign-key violation.
    op.execute(
        """
        DELETE FROM automated_validation_decisions
        WHERE report_id IN (SELECT id FROM reports WHERE scan_id IS NULL)
        """
    )
    op.execute(
        """
        DELETE FROM audit_events
        WHERE subject_type = 'report'
          AND subject_id IN (SELECT id::text FROM reports WHERE scan_id IS NULL)
        """
    )
    op.execute("DELETE FROM reports WHERE scan_id IS NULL")
    op.alter_column("reports", "scan_id", nullable=False)
    op.create_index("ix_reports_scan_id", "reports", ["scan_id"])


def downgrade() -> None:
    op.drop_index("ix_reports_scan_id", table_name="reports")
    op.drop_column("reports", "scan_id")
    op.drop_constraint("scan_capture_source", "scans", type_="check")
    op.drop_column("scans", "capture_source")
