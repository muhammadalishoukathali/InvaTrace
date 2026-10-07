"""Focused acceptance checks for the Epic 4 follow-up seam.

These tests deliberately exercise the router's policy functions without a
database so they remain useful in the normal lightweight test suite.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.api.routers.sightings import (
    FOLLOW_UP_MAX_M,
    FollowUpRequest,
    _status_history,
    _validate_follow_up_location,
    record_follow_up,
)
from app.core.errors import ApiProblem
from app.db.models import AuditEvent, SightingStatusEvent


def test_follow_up_location_gate_is_250_metres_and_does_not_change_removal_limit() -> None:
    now = datetime(2026, 10, 2, tzinfo=UTC)
    assert _validate_follow_up_location(
        captured_at=now - timedelta(minutes=5), accuracy_m=250, distance_m=250, now=now,
    ) == 250
    for kwargs, code in (
        ({"accuracy_m": 250.001, "distance_m": 0}, "follow_up_accuracy_too_low"),
        ({"accuracy_m": 1, "distance_m": 250.001}, "follow_up_too_far"),
        ({"accuracy_m": 1, "distance_m": 0, "captured_at": now - timedelta(minutes=5, seconds=1)}, "follow_up_location_stale"),
    ):
        with pytest.raises(ApiProblem) as raised:
            _validate_follow_up_location(captured_at=kwargs.get("captured_at", now), now=now, **{k: v for k, v in kwargs.items() if k != "captured_at"})
        assert raised.value.code == code
    assert FOLLOW_UP_MAX_M == 250


@pytest.mark.parametrize(
    ("outcome", "expected_status", "expected_state", "event_type"),
    [
        ("no_regrowth", "resolved_after_follow_up", "resolved", "followup_no_regrowth"),
        ("regrowth_present", "screened", "regrowth", "followup_regrowth"),
        ("unable_to_confirm", "removal_reported", "needed", "followup_unable"),
    ],
)
def test_follow_up_outcomes_are_atomic_and_private(
    outcome: str, expected_status: str, expected_state: str, event_type: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sighting = SimpleNamespace(
        id=uuid.uuid4(), status="removal_reported", follow_up_state="needed",
        latitude=3.14, longitude=101.69, last_followup_at=None,
    )
    session = MagicMock()
    session.scalar.side_effect = [sighting, 0.0]
    session.refresh.side_effect = lambda value: setattr(value, "last_followup_at", value.last_followup_at or datetime.now(UTC))
    monkeypatch.setattr("app.api.routers.sightings.utcnow", lambda: datetime(2026, 10, 2, tzinfo=UTC))
    response = record_follow_up(
        sighting.id,
        FollowUpRequest(
            latitude=3.14, longitude=101.69, accuracy_m=5, captured_at=datetime(2026, 10, 2, tzinfo=UTC), outcome=outcome,
        ),
        MagicMock(), SimpleNamespace(profile=SimpleNamespace(id=uuid.uuid4())), session,
    )
    added = [call.args[0] for call in session.add.call_args_list]
    event = next(row for row in added if isinstance(row, SightingStatusEvent))
    audit = next(row for row in added if isinstance(row, AuditEvent))
    assert sighting.status == expected_status
    assert response.follow_up_state == expected_state
    assert event.event_type == event_type
    assert event.report_id is None
    assert audit.event_type == f"sighting.follow_up_{outcome}"
    # The response has no latitude or longitude; coordinates remain private.
    assert not {"latitude", "longitude"} & set(response.model_dump())
    session.commit.assert_called_once()


def test_follow_up_rejects_non_removal_states_before_writing() -> None:
    sighting = SimpleNamespace(id=uuid.uuid4(), status="screened", follow_up_state=None)
    session = MagicMock()
    session.scalar.return_value = sighting
    with pytest.raises(ApiProblem) as raised:
        record_follow_up(
            sighting.id,
            FollowUpRequest(latitude=3.14, longitude=101.69, accuracy_m=1, captured_at=datetime.now(UTC), outcome="no_regrowth"),
            MagicMock(), SimpleNamespace(profile=SimpleNamespace(id=uuid.uuid4())), session,
        )
    assert raised.value.status_code == 409
    assert raised.value.code == "follow_up_not_available"
    session.add.assert_not_called()


def test_sighting_source_keeps_history_private_and_orders_it_ascending() -> None:
    source = (Path(__file__).parents[1] / "app/api/routers/sightings.py").read_text()
    assert '.order_by(SightingStatusEvent.created_at.asc(), SightingStatusEvent.id.asc())' in source
    history_query = source.split("follow_up_history =", 1)[1].split("return SightingDetailResponse", 1)[0]
    assert "SightingStatusEvent.latitude" not in history_query
    assert "SightingStatusEvent.longitude" not in history_query


def test_status_history_does_not_duplicate_public_report_counts_or_removal_date() -> None:
    source = (Path(__file__).parents[1] / "app/api/routers/sightings.py").read_text()
    assert "func.count(func.distinct(Report.id))" in source
    # A later follow-up must not overwrite the date labelled as the original
    # removal report in either list or detail serializers.
    assert source.count('SightingStatusEvent.event_type == "removal_reported"') >= 2


def test_status_history_opens_with_original_report_in_date_order() -> None:
    reported = datetime(2026, 9, 1, tzinfo=UTC)
    removed = datetime(2026, 9, 5, tzinfo=UTC)
    resolved = datetime(2026, 10, 2, tzinfo=UTC)
    history = _status_history(
        first_reported_at=reported,
        events=[("removal_reported", removed), ("followup_no_regrowth", resolved)],
    )
    assert [entry["event_type"] for entry in history] == [
        "reported", "removal_reported", "followup_no_regrowth",
    ]
    # An ordinary active sighting has no status history to show.
    assert _status_history(first_reported_at=reported, events=[]) == []
