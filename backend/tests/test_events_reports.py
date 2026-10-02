"""Report compatibility and event-tag rejection boundaries."""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.api.routers.reports import request_digest
from app.api.schemas import ReportResponse, ReportSubmission
from app.core.errors import ApiProblem
from app.core.idempotency import canonical_request_hash
from app.services import events


def payload():
    return dict(
        photoKey="uploads/example.jpg",
        speciesId="mikania-micrantha",
        outcome="target",
        confidence=0.9,
        modelVersion="test-model",
        observedAt=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        captureId=str(uuid.uuid4()),
        captureSource="camera",
        location={"lat": 3.005, "lng": 101.005},
        locationAccuracyM=10,
        extent="single",
        notes="",
        consent={"accurate": True, "noPII": True},
    )


def test_ordinary_submission_and_idempotency_digest_are_unchanged():
    original = payload()
    body = ReportSubmission.model_validate(original)
    wire = body.model_dump(mode="json", by_alias=True)
    assert "eventId" not in wire and "capturedAt" not in wire
    assert request_digest(body) == canonical_request_hash({**original, "imageSha256": None})


def test_ordinary_response_has_identical_keys_and_event_response_is_additive():
    original = dict(
        id=str(uuid.uuid4()),
        status="processing",
        createdAt=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        submission=payload(),
        trackingUrl="/reports/test",
        validation={
            "reasonCodes": [],
            "retryable": False,
            "policyVersion": None,
            "screeningMethod": None,
        },
        sightingId=None,
        retainedReportId=None,
    )
    assert (
        ReportResponse.model_validate(original).model_dump(mode="json", by_alias=True) == original
    )
    event_id = str(uuid.uuid4())
    response = ReportResponse.model_validate(
        {
            **original,
            "eventId": event_id,
            "evidenceLabel": "community_reported",
            "submission": {
                **original["submission"],
                "eventId": event_id,
                "capturedAt": original["submission"]["observedAt"],
            },
        }
    )
    result = response.model_dump(mode="json", by_alias=True)
    assert result["eventId"] == event_id and result["submission"]["capturedAt"]
    assert result["evidenceLabel"] == "community_reported"


@pytest.mark.parametrize(
    "status,hidden,code",
    [
        ("draft", False, "event_not_taggable"),
        ("cancelled", False, "event_not_taggable"),
        ("published", True, "event_not_taggable"),
    ],
)
def test_report_tag_rejection_has_no_writes(status, hidden, code):
    now = datetime.now(UTC)
    event = SimpleNamespace(
        id=uuid.uuid4(),
        status=status,
        hidden=hidden,
        start_at=now - timedelta(hours=1),
        end_at=now + timedelta(hours=1),
    )
    session = MagicMock()
    session.scalar.return_value = event
    with pytest.raises(ApiProblem) as caught:
        events.validate_event_report(session, event.id, uuid.uuid4(), 3.005, 101.005, now, now)
    assert caught.value.code == code
    session.add.assert_not_called()
    session.commit.assert_not_called()


@pytest.mark.parametrize(
    "capture,elapsed,checkin,budget,code",
    [
        (None, 0, True, 0, "captured_at_required"),
        (-2, 0, True, 0, "captured_at_outside_event"),
        (0, 26, True, 0, "upload_grace_exceeded"),
        (0, 0, False, 0, "checkin_required"),
        (0, 0, True, 60, "event_budget_exceeded"),
    ],
)
def test_capture_checkin_grace_and_budget_gates(
    monkeypatch, capture, elapsed, checkin, budget, code
):
    now = datetime.now(UTC)
    event = SimpleNamespace(
        id=uuid.uuid4(),
        status="published",
        hidden=False,
        start_at=now - timedelta(hours=1),
        end_at=now + timedelta(hours=1),
    )
    session = MagicMock()
    session.scalar.side_effect = [event, uuid.uuid4() if checkin else None, budget]
    monkeypatch.setattr(events, "assert_event_geometry_current", lambda *_: (object(), "park"))
    monkeypatch.setattr(events, "point_within_event_place", lambda *_: True)
    with pytest.raises(ApiProblem) as caught:
        events.validate_event_report(
            session,
            event.id,
            uuid.uuid4(),
            3.005,
            101.005,
            None if capture is None else now + timedelta(hours=capture),
            now + timedelta(hours=elapsed),
        )
    assert caught.value.code == code
    session.add.assert_not_called()


def test_upload_grace_includes_exact_boundary(monkeypatch):
    now = datetime.now(UTC)
    event = SimpleNamespace(
        id=uuid.uuid4(),
        status="completed",
        hidden=False,
        start_at=now - timedelta(hours=1),
        end_at=now + timedelta(hours=1),
    )
    session = MagicMock()
    session.scalar.side_effect = [event, uuid.uuid4(), 59]
    monkeypatch.setattr(events, "assert_event_geometry_current", lambda *_: (object(), "park"))
    monkeypatch.setattr(events, "point_within_event_place", lambda *_: True)
    assert (
        events.validate_event_report(
            session, event.id, uuid.uuid4(), 3.005, 101.005, now, event.end_at + timedelta(hours=24)
        )
        is event
    )
