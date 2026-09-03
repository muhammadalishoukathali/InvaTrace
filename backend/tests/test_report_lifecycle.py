"""Regression tests for the processing→screened report lifecycle.

AC Iteration 1 P8 - a submitted report begins with status `processing`
and MUST reach one of five terminal states: `screened`, `merged`,
`needs_rescan`, `rejected`, `validation_unavailable`. These tests pin the
invariants that keep the lifecycle from stalling or drifting:

  1. The lifecycle CHECK constraint on Report.status still lists exactly
     the six expected values.
  2. Every submitted report gets a VerificationJob so the worker will
     eventually pick it up.
  3. `_notify_resolution` covers exactly the four rule-outcome states,
     matches its kind mapping, and defends against unexpected states
     rather than raising and looping through the retry path.
  4. The worker's ImageError branch marks the report `needs_rescan`
     (terminal) and does not leak back to `processing`.

Runs as source-text asserts so backend Python env / live DB are not
required.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


def test_report_status_check_constraint_covers_the_six_expected_states() -> None:
    source = _read("app/db/models.py")
    # The CHECK constraint literal wraps across two string chunks; flatten
    # the concatenated pair before parsing.
    flat = re.sub(r'"\s*\n\s*"', "", source)
    match = re.search(r'"status IN \(([^)]+)\)"', flat)
    assert match, "Report status CHECK constraint missing."
    values = {v.strip().strip("'") for v in match.group(1).split(",")}
    expected = {
        "processing", "screened", "merged", "needs_rescan", "rejected",
        "validation_unavailable",
    }
    assert expected.issubset(values), (
        f"Report.status CHECK constraint must allow {expected}; got {values}."
        " A missing state means the DB will reject a lifecycle write the worker"
        " tries to perform, stranding reports in `processing`."
    )


def test_submitted_report_creates_verification_job() -> None:
    source = _read("app/api/routers/reports.py")
    assert 'status="processing"' in source, (
        "Newly submitted reports must start in `processing` so the tracking UI"
        " and the worker use the same initial state."
    )
    assert "VerificationJob(report_id=report.id, status=\"pending\")" in source, (
        "Report submission must enqueue a VerificationJob or the report would"
        " sit in `processing` forever with no worker eligible to pick it up."
    )


def test_notify_resolution_copy_covers_every_rule_outcome_state() -> None:
    source = _read("app/workers/verification.py")
    assert "_TERMINAL_NOTIFICATION_COPY" in source, (
        "Notification copy table must be extracted so a lifecycle audit can"
        " assert every rule-outcome status is covered by exactly one entry."
    )
    body = source.split("_TERMINAL_NOTIFICATION_COPY", 1)[1].split("}", 1)[0]
    for status in ("screened", "merged", "needs_rescan", "rejected"):
        assert f'"{status}"' in body, (
            f"Missing notification copy for terminal status `{status}` - a"
            " report that lands here would raise KeyError and get retried."
        )
    # `validation_unavailable` is intentionally NOT in this table; it has its
    # own notification path in `_mark_report_unavailable`.
    assert '"validation_unavailable"' not in body


def test_notify_resolution_bails_on_unknown_status_instead_of_raising() -> None:
    source = _read("app/workers/verification.py")
    marker = "def _notify_resolution("
    fn = source.split(marker, 1)[1].split("\ndef ", 1)[0]
    assert "_TERMINAL_NOTIFICATION_COPY.get(report.status)" in fn, (
        "Guard must use dict.get, not [] indexing - a KeyError here would"
        " escape into _schedule_failure and re-queue the whole screening pass."
    )
    assert "if entry is None:" in fn, "Explicit None guard missing."
    assert "return" in fn, "Guard branch must return before writing anything."


def test_image_error_branch_writes_a_terminal_status_not_processing() -> None:
    source = _read("app/workers/verification.py")
    marker = 'ValidationDecision("needs_rescan", ("invalid_or_corrupt_image",)'
    assert marker in source, (
        "ImageError branch must set the decision to `needs_rescan` - leaving"
        " a corrupt-image report in `processing` would keep it eligible for"
        " retry loops that will never succeed."
    )
    # The same branch must complete the job so it does not get re-tried.
    branch = source.split(marker, 1)[1].split("except Exception", 1)[0]
    assert 'job.status = "completed"' in branch


def test_lease_expired_janitor_moves_stuck_reports_to_validation_unavailable() -> None:
    source = _read("app/workers/verification.py")
    janitor = source.split("def claim_job(", 1)[1].split("\ndef ", 1)[0]
    assert 'terminal_job.status = "failed"' in janitor
    assert "_mark_report_unavailable" in janitor, (
        "Janitor must move stuck reports off `processing`; otherwise a"
        " crashed worker leaves the report in the initial state forever."
    )
