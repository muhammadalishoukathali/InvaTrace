"""Real-PostGIS checks for event-tagged report submission.

The module is opt-in and only intended for the disposable local IT3 database.
Object storage is the sole mocked boundary; all report/event state is real.
"""

from __future__ import annotations

import hashlib
import os
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.api.routers import reports
from app.core.security import AuthContext, require_auth
from app.db.base import SessionLocal
from app.db.models import (
    Event,
    EventCheckin,
    MonitoredArea,
    Profile,
    Report,
    Scan,
    UploadGrant,
)
from app.main import app

pytestmark = pytest.mark.integration

if os.getenv("RUN_INVATRACE_IT3_POSTGIS") != "1":
    pytest.skip("set RUN_INVATRACE_IT3_POSTGIS=1 for local PostGIS", allow_module_level=True)

JPEG = b"\xff\xd8" + b"event-report-integration" * 64 + b"\xff\xd9"


def test_event_tagged_report_persists_and_rejections_leave_no_report(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The API must validate Event state before consuming an upload grant."""
    run = uuid.uuid4().hex[:12]
    now = datetime.now(UTC)
    with SessionLocal() as session:
        profile = Profile(public_id=f"report-event-{run}", display_name="Report tester")
        place = MonitoredArea(
            name=f"Report event place {run}",
            geometry=func.ST_GeogFromText(
                "SRID=4326;MULTIPOLYGON(((101.100 3.100,101.110 3.100,101.110 3.110,101.100 3.110,101.100 3.100)))"
            ),
            metadata_json={
                "geometry_status": "available",
                "geometry_version": "reports-it3-v1",
                "tags": {"landuse": "forest"},
            },
        )
        session.add_all((profile, place))
        session.flush()
        event = Event(
            host_profile_id=profile.id,
            place_id=place.id,
            place_type="forest",
            event_type="survey",
            title="Report integration",
            purpose="Test event reports",
            target_species_ids=["mikania-micrantha"],
            meeting_latitude=3.105,
            meeting_longitude=101.105,
            start_at=now - timedelta(hours=1),
            end_at=now + timedelta(hours=1),
            permission_context="unknown",
            status="published",
            geometry_version="reports-it3-v1",
        )
        session.add(event)
        session.flush()
        session.add(
            EventCheckin(
                event_id=event.id,
                profile_id=profile.id,
                latitude=3.105,
                longitude=101.105,
                accuracy_m=10,
            )
        )
        session.commit()
        profile_id, place_id, event_id = profile.id, place.id, event.id

    monkeypatch.setattr(reports.rate_limiter, "check", lambda *_args, **_kwargs: None)
    uploaded: dict[str, bytes] = {}
    monkeypatch.setattr(
        reports.storage,
        "head",
        lambda key: SimpleNamespace(size_bytes=len(uploaded[key]), content_type="image/jpeg"),
    )
    monkeypatch.setattr(reports.storage, "get_bytes", lambda key: uploaded[key])
    monkeypatch.setattr(reports.storage, "finalize_upload", lambda *_args, **_kwargs: None)

    def auth_override() -> AuthContext:
        with SessionLocal() as session:
            profile = session.get(Profile, profile_id)
            assert profile is not None
            return AuthContext(profile=profile, installation=None)  # type: ignore[arg-type]

    app.dependency_overrides[require_auth] = auth_override
    original_profile = profile_id

    def submission(*, event_value: str | None, captured_at: datetime | None, suffix: str) -> dict:
        capture_id = uuid.uuid4()
        key = f"uploads/{run}/{suffix}.jpg"
        image_bytes = JPEG + suffix.encode()
        uploaded[key] = image_bytes
        with SessionLocal() as session:
            session.add(
                UploadGrant(
                    profile_id=profile_id,
                    object_key=key,
                    content_type="image/jpeg",
                    size_bytes=len(image_bytes),
                    expires_at=now + timedelta(hours=1),
                )
            )
            session.add(
                Scan(
                    profile_id=profile_id,
                    capture_id=capture_id,
                    predicted_species_id="mikania-micrantha",
                    outcome="target",
                    confidence=0.9,
                    model_version="integration-v1",
                    image_sha256=hashlib.sha256(image_bytes).digest(),
                    capture_source="camera",
                )
            )
            session.commit()
        payload = {
            "photoKey": key,
            "speciesId": "mikania-micrantha",
            "outcome": "target",
            "confidence": 0.9,
            "modelVersion": "integration-v1",
            "observedAt": now.isoformat(),
            "captureId": str(capture_id),
            "captureSource": "camera",
            "location": {"lat": 3.105, "lng": 101.105},
            "locationAccuracyM": 10,
            "extent": "single",
            "notes": "",
            "consent": {"accurate": True, "noPII": True},
            "imageSha256": hashlib.sha256(image_bytes).hexdigest(),
        }
        if event_value is not None:
            payload["eventId"] = event_value
        if captured_at is not None:
            payload["capturedAt"] = captured_at.isoformat()
        return payload

    try:
        client = TestClient(app, raise_server_exceptions=False)
        ordinary = submission(event_value=None, captured_at=None, suffix="ordinary")
        ordinary_response = client.post(
            "/api/v1/reports", json=ordinary, headers={"Idempotency-Key": "ordinary-event-test"}
        )
        assert ordinary_response.status_code == 201, ordinary_response.text
        assert "eventId" not in ordinary_response.json()

        # Changing attribution must not replay the earlier ordinary success.
        response = client.post(
            "/api/v1/reports",
            json={**ordinary, "eventId": str(event_id), "capturedAt": now.isoformat()},
            headers={"Idempotency-Key": "ordinary-event-test"},
        )
        assert (
            response.status_code == 409 and response.json()["code"] == "event_report_already_linked"
        )
        duplicate = submission(event_value=str(event_id), captured_at=now, suffix="duplicate")
        original_image = uploaded[ordinary["photoKey"]]
        uploaded[duplicate["photoKey"]] = original_image
        duplicate["imageSha256"] = hashlib.sha256(original_image).hexdigest()
        with SessionLocal() as session:
            grant = session.scalar(
                select(UploadGrant).where(UploadGrant.object_key == duplicate["photoKey"])
            )
            grant.size_bytes = len(original_image)
            scan = session.scalar(
                select(Scan).where(Scan.capture_id == uuid.UUID(duplicate["captureId"]))
            )
            scan.image_sha256 = hashlib.sha256(original_image).digest()
            session.commit()
        response = client.post(
            "/api/v1/reports", json=duplicate, headers={"Idempotency-Key": "duplicate-event-test"}
        )
        assert (
            response.status_code == 409 and response.json()["code"] == "event_report_already_linked"
        )

        accepted = submission(event_value=str(event_id), captured_at=now, suffix="accepted")
        response = client.post(
            "/api/v1/reports", json=accepted, headers={"Idempotency-Key": "accepted-event-test"}
        )
        assert response.status_code == 201, response.text
        assert response.json()["eventId"] == str(event_id)
        with SessionLocal() as session:
            assert (
                session.scalar(
                    select(Report.event_id).where(Report.id == uuid.UUID(response.json()["id"]))
                )
                == event_id
            )

        missing_checkin_profile = Profile(public_id=f"no-checkin-{run}")
        with SessionLocal() as session:
            session.add(missing_checkin_profile)
            session.commit()
        profile_id = missing_checkin_profile.id
        with SessionLocal() as session:
            before_rejected = session.scalar(select(func.count(Report.id)))
        rejected = submission(event_value=str(event_id), captured_at=now, suffix="no-checkin")
        response = client.post(
            "/api/v1/reports", json=rejected, headers={"Idempotency-Key": "missing-checkin-test"}
        )
        assert response.status_code == 422 and response.json()["code"] == "checkin_required"
        with SessionLocal() as session:
            assert session.scalar(select(func.count(Report.id))) == before_rejected
        profile_id = original_profile

        outside_capture = submission(
            event_value=str(event_id), captured_at=now - timedelta(hours=2), suffix="outside"
        )
        with SessionLocal() as session:
            before_outside = session.scalar(select(func.count(Report.id)))
        response = client.post(
            "/api/v1/reports",
            json=outside_capture,
            headers={"Idempotency-Key": "outside-capture-test"},
        )
        assert (
            response.status_code == 422 and response.json()["code"] == "captured_at_outside_event"
        )
        with SessionLocal() as session:
            assert session.scalar(select(func.count(Report.id))) == before_outside
    finally:
        app.dependency_overrides.pop(require_auth, None)
        with SessionLocal() as session:
            session.execute(
                delete(Report).where(Report.profile_id.in_((profile_id, original_profile)))
            )
            session.execute(delete(Event).where(Event.id == event_id))
            session.execute(delete(MonitoredArea).where(MonitoredArea.id == place_id))
            session.execute(
                delete(Profile).where(
                    Profile.public_id.in_((f"report-event-{run}", f"no-checkin-{run}"))
                )
            )
            session.commit()
