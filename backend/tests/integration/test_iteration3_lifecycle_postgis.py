"""Real PostGIS lifecycle-worker checks for community events (opt-in)."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.api.routers import events
from app.core.security import AuthContext, require_auth
from app.db.base import SessionLocal
from app.db.models import AuditEvent, Event, MonitoredArea, Profile
from app.main import app
from app.workers.event_auto_cancel import cancel_stale_hidden_events
from app.workers.event_completion import complete_elapsed_events

pytestmark = pytest.mark.integration
if os.getenv("RUN_INVATRACE_IT3_POSTGIS") != "1":
    pytest.skip("set RUN_INVATRACE_IT3_POSTGIS=1 for local PostGIS", allow_module_level=True)


def test_event_workers_complete_and_auto_cancel_once(monkeypatch) -> None:
    monkeypatch.setattr(events.rate_limiter, "check", lambda *_args: None)
    run = uuid.uuid4().hex[:12]
    now = datetime.now(UTC)
    with SessionLocal() as session:
        profile = Profile(public_id=f"worker-event-{run}")
        place = MonitoredArea(
            name=f"Worker event place {run}",
            geometry=func.ST_GeogFromText(
                "SRID=4326;MULTIPOLYGON(((102 4,102.01 4,102.01 4.01,102 4.01,102 4)))"
            ),
            metadata_json={
                "geometry_status": "available",
                "geometry_version": "worker-v1",
                "tags": {"landuse": "forest"},
            },
        )
        session.add_all((profile, place))
        session.flush()
        completed = Event(
            host_profile_id=profile.id,
            place_id=place.id,
            place_type="forest",
            event_type="survey",
            title="elapsed",
            purpose="x",
            meeting_latitude=4.005,
            meeting_longitude=102.005,
            start_at=now - timedelta(hours=2),
            end_at=now - timedelta(minutes=1),
            permission_context="unknown",
            status="published",
            geometry_version="worker-v1",
        )
        hidden = Event(
            host_profile_id=profile.id,
            place_id=place.id,
            place_type="forest",
            event_type="survey",
            title="hidden",
            purpose="x",
            meeting_latitude=4.005,
            meeting_longitude=102.005,
            start_at=now - timedelta(days=20),
            end_at=now + timedelta(days=1),
            permission_context="unknown",
            status="published",
            hidden=True,
            hidden_at=now - timedelta(days=15),
            updated_at=now - timedelta(days=15),
            geometry_version="worker-v1",
        )
        session.add_all((completed, hidden))
        session.commit()
        ids = (completed.id, hidden.id, profile.id, place.id)
    try:
        assert complete_elapsed_events(now) == 1
        assert complete_elapsed_events(now) == 0
        assert cancel_stale_hidden_events(now) == 1
        assert cancel_stale_hidden_events(now) == 0
        with SessionLocal() as session:
            assert session.get(Event, ids[0]).status == "completed"
            assert session.get(Event, ids[1]).status == "cancelled"
            assert (
                session.scalar(
                    select(func.count(AuditEvent.id)).where(
                        AuditEvent.subject_id.in_((str(ids[0]), str(ids[1])))
                    )
                )
                == 2
            )

        def auth():
            with SessionLocal() as session:
                return AuthContext(profile=session.get(Profile, ids[2]), installation=None)

        app.dependency_overrides[require_auth] = auth
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get(f"/api/v1/events/{ids[1]}").json()["can_restore"] is True
        restored = client.patch(f"/api/v1/events/{ids[1]}", json={"restore": True})
        assert restored.status_code == 200, restored.text
        assert restored.json()["status"] == "published" and not restored.json()["hidden"]
        assert str(ids[1]) in {
            item["event_id"] for item in client.get("/api/v1/events").json()["items"]
        }
        # An intentional cancellation cannot be overridden by restore.
        assert client.delete(f"/api/v1/events/{ids[1]}").status_code == 204
        # DELETE is idempotent: retries do not create more cancellation audit rows.
        assert client.delete(f"/api/v1/events/{ids[1]}").status_code == 204
        with SessionLocal() as session:
            assert (
                session.scalar(
                    select(func.count(AuditEvent.id)).where(
                        AuditEvent.subject_id == str(ids[1]),
                        AuditEvent.event_type == "event.cancelled",
                    )
                )
                == 1
            )
        with SessionLocal() as session:
            event = session.get(Event, ids[1])
            event.hidden = True
            session.commit()
        assert client.get(f"/api/v1/events/{ids[1]}").json()["can_restore"] is False
        assert client.patch(f"/api/v1/events/{ids[1]}", json={"restore": True}).status_code == 409
    finally:
        app.dependency_overrides.pop(require_auth, None)
        with SessionLocal() as session:
            session.execute(delete(Event).where(Event.id.in_(ids[:2])))
            session.execute(delete(MonitoredArea).where(MonitoredArea.id == ids[3]))
            session.execute(delete(Profile).where(Profile.id == ids[2]))
            session.commit()
