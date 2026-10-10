"""Fast, database-free contracts for the community-events API.

PostGIS membership is exercised by the integration suite when its local
database is available.  These tests lock down request validation and the
security/lifecycle gates that must not silently disappear in refactors.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.api.routers.events import CheckinRequest, EventCreate
from app.core.errors import ApiProblem


def _event_payload() -> dict[str, object]:
    now = datetime.now(UTC)
    return {
        "placeId": str(uuid.uuid4()),
        "eventType": "survey",
        "title": "Community survey",
        "purpose": "Record community observations.",
        "meetingLatitude": 3.139,
        "meetingLongitude": 101.6869,
        "startAt": (now + timedelta(hours=1)).isoformat(),
        "endAt": (now + timedelta(hours=2)).isoformat(),
        "permissionContext": "unknown",
    }


def test_event_request_uses_camel_case_and_rejects_inverted_time_range() -> None:
    payload = _event_payload()
    event = EventCreate.model_validate(payload)
    assert event.place_id == uuid.UUID(payload["placeId"])
    payload["endAt"] = payload["startAt"]
    with pytest.raises(ValidationError):
        EventCreate.model_validate(payload)


def test_event_request_never_accepts_non_https_chat_link() -> None:
    payload = _event_payload()
    payload["chatLink"] = "http://example.invalid/group"
    with pytest.raises(ValidationError):
        EventCreate.model_validate(payload)


def test_checkin_requires_a_recent_timestamped_gps_fix() -> None:
    current = datetime.now(UTC)
    parsed = CheckinRequest.model_validate(
        {
            "latitude": 3.139,
            "longitude": 101.6869,
            "accuracyM": 12,
            "capturedAt": current.isoformat(),
        }
    )
    assert parsed.captured_at == current
    with pytest.raises(ApiProblem, match="fresh location"):
        CheckinRequest.model_validate(
            {
                "latitude": 3.139,
                "longitude": 101.6869,
                "accuracyM": 12,
                "capturedAt": (current - timedelta(minutes=6)).isoformat(),
            }
        )


def test_event_router_has_non_enumerating_discovery_and_private_detail_guards() -> None:
    source = (Path(__file__).parents[1] / "app/api/routers/events.py").read_text(encoding="utf-8")
    assert 'Event.status == "published"' in source
    assert "Event.hidden.is_(False)" in source
    assert "event.host_profile_id != auth.profile.id" in source
    assert (
        '"host_profile_id"'
        not in source.split("def _serialize", 1)[1].split("def _event_or_404", 1)[0]
    )
    assert "is_host or joined" in source


def test_event_router_locks_host_cap_and_activity_sensitive_changes() -> None:
    source = (Path(__file__).parents[1] / "app/api/routers/events.py").read_text(encoding="utf-8")
    cap = source.split("def _host_cap", 1)[1].split("def _serialize", 1)[0]
    assert ".with_for_update()" in cap
    patch = source.split("def patch_event", 1)[1].split("def cancel_event", 1)[0]
    assert "event_fields_locked" in patch
    assert "_activity_locked" in patch
    assert '"event_not_hidden"' in patch
    cancel = source.split("def cancel_event", 1)[1].split("def _upcoming_statement", 1)[0]
    withdraw = source.split("def withdraw_event", 1)[1].split("def check_in", 1)[0]
    assert 'rate_limiter.check("events_write", str(auth.profile.id))' in cancel
    assert 'rate_limiter.check("events_write", str(auth.profile.id))' in withdraw
    assert 'if event.status == "cancelled":' in cancel
    assert 'if event.status not in {"draft", "published"}:' in cancel


def test_workers_are_idempotent_and_only_auto_cancel_hidden_published_events() -> None:
    root = Path(__file__).parents[1] / "app/workers"
    completion = (root / "event_completion.py").read_text(encoding="utf-8")
    cancellation = (root / "event_auto_cancel.py").read_text(encoding="utf-8")
    assert 'Event.status == "published"' in completion
    assert 'event.status = "completed"' in completion
    assert 'Event.status == "published"' in cancellation
    assert "Event.hidden.is_(True)" in cancellation
    assert "func.coalesce(Event.hidden_at, Event.updated_at) < cutoff" in cancellation


def test_unchanged_locked_values_are_not_treated_as_edits() -> None:
    from decimal import Decimal

    from app.api.routers.events import _same_value

    start = datetime(2030, 1, 1, 8, tzinfo=UTC)
    place = uuid.uuid4()
    assert _same_value(Decimal("3.13900"), 3.139)
    assert not _same_value(Decimal("3.13900"), 3.14)
    assert _same_value(start, start.astimezone(UTC))
    assert not _same_value(start, start + timedelta(minutes=1))
    assert _same_value(place, place)
    assert _same_value("survey", "survey")
    assert not _same_value("survey", "removal")


def test_permission_context_is_optional_and_legacy_values_are_accepted() -> None:
    payload = _event_payload()
    payload.pop("permissionContext")
    assert EventCreate.model_validate(payload).permission_context is None
    payload["permissionContext"] = "explicit_permission"
    assert EventCreate.model_validate(payload).permission_context == "explicit_permission"


def test_hosting_gate_is_off_by_default_for_internal_testing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.routers import events
    from app.config import get_settings

    assert get_settings().event_host_gate_enabled is False
    monkeypatch.setattr(events, "_host_report_count", lambda *_args: 0)
    events._assert_can_host(None, uuid.uuid4())  # type: ignore[arg-type]


def test_hosting_is_locked_until_enough_reports(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.routers import events
    from app.config import get_settings

    enabled = get_settings().model_copy(update={"event_host_gate_enabled": True})
    monkeypatch.setattr(events, "get_settings", lambda: enabled)
    monkeypatch.setattr(events, "_host_report_count", lambda *_args: 2)
    with pytest.raises(ApiProblem) as error:
        events._assert_can_host(None, uuid.uuid4())  # type: ignore[arg-type]
    assert error.value.status_code == 403
    assert error.value.code == "hosting_locked"
    assert "2 of 3" in error.value.detail
    monkeypatch.setattr(events, "_host_report_count", lambda *_args: 3)
    events._assert_can_host(None, uuid.uuid4())  # type: ignore[arg-type]


def test_rejected_and_rescan_reports_do_not_count_towards_hosting() -> None:
    from app.api.routers.events import COUNTED_REPORT_EXCLUDED_STATUSES

    assert set(COUNTED_REPORT_EXCLUDED_STATUSES) == {"rejected", "needs_rescan"}


def test_land_status_only_allows_removal_outside_mapped_protected_land() -> None:
    from app.services.land_status import LandStatus

    assert "removal" in LandStatus("not_protected").allowed_event_types
    for status in ("protected", "uncertain"):
        allowed = LandStatus(status).allowed_event_types  # type: ignore[arg-type]
        assert "removal" not in allowed
        assert {"survey", "monitoring", "other"} <= set(allowed)
    assert "Gate Reserve" in LandStatus("protected", protected_area_name="Gate Reserve").reason


def test_land_status_rejects_disallowed_event_type_and_records_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    from app.api.routers import events
    from app.services.land_status import LandStatus

    event = SimpleNamespace(
        event_type="removal", land_status=None, protected_area_name=None, permission_context="x"
    )
    monkeypatch.setattr(
        events, "place_land_status", lambda *_args: LandStatus("protected", "Gate Reserve")
    )
    with pytest.raises(ApiProblem) as error:
        events._apply_land_status(None, event, None, "park")  # type: ignore[arg-type]
    assert error.value.status_code == 422
    assert error.value.code == "removal_not_allowed_here"
    event.event_type = "survey"
    events._apply_land_status(None, event, None, "park")  # type: ignore[arg-type]
    assert event.land_status == "protected"
    assert event.protected_area_name == "Gate Reserve"
    assert event.permission_context == "unknown"


def test_publish_and_type_changes_recheck_land_status() -> None:
    source = (Path(__file__).parents[1] / "app/api/routers/events.py").read_text(encoding="utf-8")
    create = source.split("def create_event", 1)[1].split("def patch_event", 1)[0]
    patch = source.split("def patch_event", 1)[1].split("def cancel_event", 1)[0]
    assert "_assert_can_host(session, auth.profile.id)" in create
    assert "_apply_land_status" in create
    assert patch.count("_apply_land_status") == 2


def test_router_guards_terminal_edits_flags_and_join_contract() -> None:
    source = (Path(__file__).parents[1] / "app/api/routers/events.py").read_text(encoding="utf-8")
    patch = source.split("def patch_event", 1)[1].split("def cancel_event", 1)[0]
    assert '"Only draft or published events can be edited."' in patch
    assert '"event_already_ended"' in patch
    join = source.split("def join_event", 1)[1].split("def withdraw_event", 1)[0]
    assert '"event_id": event.id' in join and '"joined_at"' in join
    flag = source.split("def flag_event", 1)[1].split("def event_summary", 1)[0]
    assert '"event_not_flaggable"' in flag
    assert 'kind="system"' in flag
    cap = source.split("def _host_cap", 1)[1].split("def _can_restore", 1)[0]
    assert "Event.end_at > utcnow()" in cap


def test_event_window_rejects_past_long_and_far_future_starts() -> None:
    from app.api.routers.events import _assert_event_window

    now = datetime.now(UTC)

    def code(start: datetime, end: datetime, start_changed: bool = True) -> str | None:
        try:
            _assert_event_window(start, end, start_changed=start_changed)
        except ApiProblem as error:
            return error.code
        return None

    assert code(now + timedelta(hours=1), now + timedelta(hours=3)) is None
    # A slot picked a few minutes ago is still accepted while the form is finished.
    assert code(now - timedelta(minutes=10), now + timedelta(hours=1)) is None
    assert code(now - timedelta(minutes=20), now + timedelta(hours=1)) == "event_start_in_past"
    assert code(now + timedelta(hours=1), now + timedelta(hours=1)) == "invalid_event_time"
    assert code(now + timedelta(hours=1), now + timedelta(hours=13, minutes=1)) == "event_too_long"
    assert (
        code(now + timedelta(days=366), now + timedelta(days=366, hours=1)) == "event_start_too_far"
    )
    # An unchanged start (e.g. editing only the end of a running event) is not re-judged.
    assert code(now - timedelta(hours=2), now + timedelta(hours=1), start_changed=False) is None
