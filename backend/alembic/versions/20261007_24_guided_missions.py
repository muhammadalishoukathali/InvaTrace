"""Epic 7 guided habitat search missions and optional report/scan links."""

import sqlalchemy as sa

from alembic import op

revision = "20261007_24"
down_revision = "20261002_23"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "guided_missions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "profile_id",
            sa.UUID(),
            sa.ForeignKey("profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Places are the union of monitored areas and trails (as for events and
        # adopted areas), so the reference is validated by the API, not an FK.
        sa.Column("place_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("dataset_version", sa.String(80), nullable=False),
        sa.Column("selected_species_id", sa.String(80)),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('active','completed')", name="status"),
        sa.CheckConstraint(
            "(status = 'completed') = (completed_at IS NOT NULL)", name="completed_at"
        ),
    )
    op.create_index("ix_guided_missions_profile_id", "guided_missions", ["profile_id"])
    op.create_index(
        "uq_guided_missions_active_profile_place",
        "guided_missions",
        ["profile_id", "place_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_table(
        "guided_mission_plant_progress",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "mission_id",
            sa.UUID(),
            sa.ForeignKey("guided_missions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("species_id", sa.String(80), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("state", sa.String(20), nullable=False, server_default="not_checked"),
        sa.Column("no_target_found", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("mission_id", "species_id", name="uq_guided_mission_plant"),
        sa.CheckConstraint("state IN ('not_checked','looked_for','unable_to_check')", name="state"),
        sa.CheckConstraint(
            "NOT no_target_found OR state = 'looked_for'", name="no_find_requires_looked_for"
        ),
    )
    op.create_index(
        "ix_guided_mission_plant_progress_mission_id",
        "guided_mission_plant_progress",
        ["mission_id"],
    )
    for table in ("reports", "scans"):
        op.add_column(table, sa.Column("mission_id", sa.UUID(), nullable=True))
        op.create_foreign_key(
            f"fk_{table}_mission_id_guided_missions",
            table,
            "guided_missions",
            ["mission_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(f"ix_{table}_mission_id", table, ["mission_id"])


def downgrade():
    for table in ("scans", "reports"):
        op.drop_index(f"ix_{table}_mission_id", table_name=table)
        op.drop_constraint(f"fk_{table}_mission_id_guided_missions", table, type_="foreignkey")
        op.drop_column(table, "mission_id")
    op.drop_table("guided_mission_plant_progress")
    op.drop_table("guided_missions")
