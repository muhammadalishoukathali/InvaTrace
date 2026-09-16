"""Regression tests for the AC 2.3.2 near-duplicate merge query.

The rule: same anonymous identity, same species, prior *report* observed
within 25 m and 10 min of the incoming *report* → the incoming report is
folded into the retained sighting. Distance and the time window are computed
from stored report evidence, not from ``Sighting.updated_at`` (which is
bumped by worker processing and later merges) and not from GPS accuracy
expansion.

Runs as source-text asserts so backend Python env / a live PostGIS are not
required - the actual PostGIS behaviour is exercised by the integration
suite under ``RUN_INVATRACE_INTEGRATION=1``.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _merge_target_body() -> str:
    source = (REPO_ROOT / "app/workers/verification.py").read_text()
    marker = "def _find_merge_target("
    assert marker in source, "_find_merge_target helper missing."
    body = source.split(marker, 1)[1].split("\ndef ", 1)[0]
    # Drop the docstring so the invariants below are checked against actual
    # executable code, not commentary that happens to mention a symbol.
    if '"""' in body:
        _, _, after_open = body.partition('"""')
        _, _, code = after_open.partition('"""')
        body = code
    return body


def _process_job_body() -> str:
    source = (REPO_ROOT / "app/workers/verification.py").read_text()
    marker = "def process_job("
    assert marker in source, "process_job helper missing."
    return source.split(marker, 1)[1].split("\ndef ", 1)[0]


def test_merge_target_is_scoped_to_same_profile() -> None:
    body = _merge_target_body()
    # Both the prior report and its published sighting must belong to the
    # same anonymous identity as the incoming report.
    assert "Report.profile_id == report.profile_id" in body, (
        "Near-duplicate merges must stay within a single anonymous identity."
        " Cross-owner near-coincidences publish as their own pins."
    )
    assert "Sighting.source_profile_id == report.profile_id" in body


def test_merge_target_uses_exact_radius_no_accuracy_expansion() -> None:
    body = _merge_target_body()
    assert "settings.screening_duplicate_radius_max_m" in body, (
        "Merge radius must come from screening_duplicate_radius_max_m - hard"
        " coded values or accuracy-based expansion would let cross-user reports"
        " inside the GPS fuzz zone get silently merged."
    )
    assert "location_accuracy_m" not in body, (
        "The 25 m radius is intentionally independent of GPS accuracy;"
        " referencing location_accuracy_m in this helper would re-introduce"
        " the accuracy-expansion regression called out in AC 2.3.2."
    )


def test_merge_target_uses_st_dwithin_and_orders_by_distance() -> None:
    body = _merge_target_body()
    # report.location on the ORM instance is a WKBElement; the helper pins it
    # to Geography("POINT", srid=4326) via `report_location` before handing it
    # to ST_DWithin/ST_Distance, so PostGIS resolves the geography overload
    # (metres) and cannot regress to the geometry overload (degrees).
    assert 'cast(report.location, Geography("POINT", srid=4326))' in body, (
        "report.location must be cast to Geography before ST_DWithin/ST_Distance"
        " so radius/distance are geodesic metres, not degree-unit planar."
    )
    assert "func.ST_DWithin(Sighting.location, report_location, radius_m)" in body, (
        "Filter must use ST_DWithin on stored geography columns so PostGIS"
        " computes geodesic (meters) distance, not planar."
    )
    assert "func.ST_Distance(Sighting.location, report_location)" in body, (
        "Order-by must use ST_Distance so the closest qualifying candidate"
        " wins when several sit inside the 25 m radius."
    )


def test_merge_target_window_uses_prior_report_observation_time() -> None:
    body = _merge_target_body()
    # AC 2.3.2 - window compares prior *report* observed_at to the incoming
    # report observed_at, not Sighting.updated_at (bumped by worker/merges)
    # and not datetime.now().
    assert "Report.observed_at >= window_start" in body, (
        "Ten-minute window must gate on the prior report's observation time"
        " so a delayed or replayed submission is compared observation-to-"
        "observation, not against sightings that were merely 'active' at"
        " screening time."
    )
    assert "Report.observed_at <= observation_time" in body, (
        "A prior report observed AFTER the incoming report cannot be a merge"
        " target - the window is one-sided into the past."
    )
    assert "Sighting.updated_at" not in body, (
        "Sighting.updated_at is bumped by worker processing and later merges"
        " and must not gate the observation-time window (AC 2.3.2)."
    )
    assert "cutoff = datetime.now(UTC) - timedelta" not in body


def test_merge_target_joins_prior_report_to_active_link() -> None:
    body = _merge_target_body()
    # The query must reach Sighting via Report → active ReportSightingLink,
    # otherwise the retained-report id (needed for the API response and the
    # audit event) cannot be recovered from the same row.
    assert ".join(ReportSightingLink, ReportSightingLink.report_id == Report.id)" in body
    assert ".join(Sighting, Sighting.id == ReportSightingLink.sighting_id)" in body
    assert "ReportSightingLink.active.is_(True)" in body


def test_merge_target_returns_structured_candidate() -> None:
    body = _merge_target_body()
    # Positional tuples let distance and time-delta swap places silently;
    # the AC-required audit event names both, so the return must too.
    assert "MergeCandidate(" in body, (
        "Merge lookup must return a structured MergeCandidate rather than a"
        " positional tuple so retained-report / distance / time-delta cannot"
        " be swapped by callers."
    )
    dataclass_source = (REPO_ROOT / "app/workers/verification.py").read_text()
    assert "class MergeCandidate:" in dataclass_source
    for field in (
        "retained_report:",
        "sighting:",
        "distance_m:",
        "time_difference_seconds:",
    ):
        assert field in dataclass_source, f"MergeCandidate missing field `{field}`."


def test_merge_target_tie_break_is_deterministic() -> None:
    body = _merge_target_body()
    # 1) shortest distance, 2) smallest time delta, 3) most recent prior
    # observation, 4) prior report id as a stable final tie-break.
    for expected in (
        "distance_expr.asc()",
        "time_diff_expr.asc()",
        "Report.observed_at.desc()",
        "Report.id.asc()",
    ):
        assert expected in body, f"Deterministic tie-break requires `{expected}` in the order_by."
    # Ordering must appear in the required sequence - closest first, then
    # smallest time delta, then most recent, then id as final tie-break.
    positions = [
        body.index("distance_expr.asc()"),
        body.index("time_diff_expr.asc()"),
        body.index("Report.observed_at.desc()"),
        body.index("Report.id.asc()"),
    ]
    assert positions == sorted(positions), (
        "order_by clauses must appear in the tie-break order given by AC 2.3.2."
    )


def test_process_job_persists_merged_into_report_id() -> None:
    body = _process_job_body()
    assert "report.merged_into_report_id = merge_candidate.retained_report.id" in body, (
        "AC 2.3.2 - the incoming report row must record the retained report"
        " id so /api/v1/reports/{id} can expose retainedReportId without"
        " re-joining the audit log."
    )


def test_process_job_writes_audit_event_with_required_fields() -> None:
    source = (REPO_ROOT / "app/workers/verification.py").read_text()
    marker = 'event_type="report.merged_into_sighting"'
    assert marker in source, "Dedicated merge audit event missing."
    block = source.split(marker, 1)[1].split("session.add", 1)[0]
    for key in (
        '"incomingReportId"',
        '"retainedReportId"',
        '"speciesId"',
        '"calculatedDistanceM"',
        '"timeDifferenceSeconds"',
        '"mergeReason"',
    ):
        assert key in block, (
            f"Merge audit metadata missing required key {key} - every AC 2.3.2"
            " required field must be recorded in this dedicated event."
        )


def test_report_response_exposes_retained_report_id() -> None:
    schemas = (REPO_ROOT / "app/api/schemas.py").read_text()
    reporting = (REPO_ROOT / "app/domain/reporting.py").read_text()
    assert "retained_report_id: str | None" in schemas, (
        "ReportResponse must declare retained_report_id (serialises as"
        " retainedReportId) so the client can distinguish a merged report"
        " from a freshly published one."
    )
    assert "retained_report_id=" in reporting, (
        "report_response() must populate retained_report_id from the ORM"
        " row's merged_into_report_id column."
    )


def test_report_model_declares_merged_into_report_id_self_reference() -> None:
    models = (REPO_ROOT / "app/db/models.py").read_text()
    assert "merged_into_report_id: Mapped[uuid.UUID | None]" in models
    assert 'ForeignKey("reports.id", ondelete="SET NULL")' in models, (
        "Self-reference must use ON DELETE SET NULL so deleting the retained"
        " report never cascades away the merged one."
    )


def test_merge_audit_reason_codes_distinguish_replay_from_nearby() -> None:
    source = (REPO_ROOT / "app/workers/verification.py").read_text()
    # Exact same-owner photo replays and 25 m/10 min proximity merges are
    # different mechanisms and must carry different reason codes so a merge
    # is never mislabelled as satisfying the AC 2.3.2 spatial/temporal rule.
    assert '"same_owner_same_species_exact_replay"' in source
    assert '"same_owner_same_species_within_25m_and_10m"' in source


def test_alembic_migration_adds_merged_into_report_id_column() -> None:
    migration = (
        REPO_ROOT / "alembic" / "versions" / "20260903_12_report_merged_into_report.py"
    ).read_text()
    assert "ADD COLUMN merged_into_report_id UUID" in migration
    assert "ON DELETE SET NULL" in migration
    assert "ix_reports_merged_into_report_id" in migration
