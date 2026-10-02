"""Additional real-PostGIS event authorization and filtering edge cases."""

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
from app.db.models import Event, EventCheckin, EventParticipant, MonitoredArea, Profile
from app.main import app

pytestmark = pytest.mark.integration
if os.getenv("RUN_INVATRACE_IT3_POSTGIS") != "1":
    pytest.skip("set RUN_INVATRACE_IT3_POSTGIS=1 for local PostGIS", allow_module_level=True)


def test_host_cap_ownership_and_activity_locking(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(events.rate_limiter, "check", lambda *_args, **_kwargs: None)
    run, now = uuid.uuid4().hex[:10], datetime.now(UTC)
    with SessionLocal() as s:
        host, other = Profile(public_id=f"edge-host-{run}"), Profile(public_id=f"edge-other-{run}")
        place = MonitoredArea(
            name=f"Edge place {run}",
            geometry=func.ST_GeogFromText(
                "SRID=4326;MULTIPOLYGON(((103 5,103.01 5,103.01 5.01,103 5.01,103 5)))"
            ),
            metadata_json={
                "geometry_status": "available",
                "geometry_version": "edge-v1",
                "tags": {"landuse": "forest"},
            },
        )
        s.add_all((host, other, place))
        s.commit()
        ids = (host.id, other.id, place.id)
    current = {"id": ids[0]}

    def auth() -> AuthContext:
        with SessionLocal() as s:
            p = s.get(Profile, current["id"])
            assert p
            return AuthContext(profile=p, installation=None)  # type: ignore[arg-type]

    app.dependency_overrides[require_auth] = auth

    def payload(title: str) -> dict:
        return {
            "placeId": str(ids[2]),
            "eventType": "survey",
            "title": title,
            "purpose": "p",
            "meetingLatitude": 5.005,
            "meetingLongitude": 103.005,
            "startAt": (now - timedelta(minutes=10)).isoformat(),
            "endAt": (now + timedelta(hours=2)).isoformat(),
            "permissionContext": "unknown",
        }

    event_ids: list[str] = []
    try:
        c = TestClient(app, raise_server_exceptions=False)
        for n in range(3):
            r = c.post("/api/v1/events", json=payload(str(n)))
            assert r.status_code == 201, r.text
            event_ids.append(r.json()["event_id"])
        assert c.post("/api/v1/events", json=payload("cap")).status_code == 429
        current["id"] = ids[1]
        assert c.get(f"/api/v1/events/{event_ids[1]}").status_code == 404
        assert c.patch(f"/api/v1/events/{event_ids[0]}", json={"title": "no"}).status_code == 403
        current["id"] = ids[0]
        assert (
            c.patch(f"/api/v1/events/{event_ids[0]}", json={"status": "published"}).status_code
            == 200
        )
        with SessionLocal() as s:
            s.add(
                EventCheckin(
                    event_id=uuid.UUID(event_ids[0]),
                    profile_id=ids[0],
                    latitude=5.005,
                    longitude=103.005,
                    accuracy_m=5,
                )
            )
            s.commit()
        assert (
            c.patch(f"/api/v1/events/{event_ids[0]}", json={"meetingLatitude": 5.006}).status_code
            == 409
        )
        with SessionLocal() as s:
            before = s.scalar(
                select(func.count(EventCheckin.id)).where(
                    EventCheckin.event_id == uuid.UUID(event_ids[0])
                )
            )
            participants_before = s.scalar(
                select(func.count(EventParticipant.id)).where(
                    EventParticipant.event_id == uuid.UUID(event_ids[0])
                )
            )
        rejected = c.post(
            f"/api/v1/events/{event_ids[0]}/check-in",
            json={
                "latitude": 5.2,
                "longitude": 103.2,
                "accuracyM": 10,
                "capturedAt": datetime.now(UTC).isoformat(),
            },
        )
        assert rejected.status_code == 422 and rejected.json()["code"] == "outside_place"
        for patch, code in [
            ({"accuracyM": 251}, "accuracy_too_low"),
            (
                {"capturedAt": (datetime.now(UTC) - timedelta(minutes=6)).isoformat()},
                "fresh_location_required",
            ),
        ]:
            result = c.post(
                f"/api/v1/events/{event_ids[0]}/check-in",
                json={
                    "latitude": 5.005,
                    "longitude": 103.005,
                    "accuracyM": 10,
                    "capturedAt": datetime.now(UTC).isoformat(),
                    **patch,
                },
            )
            assert result.status_code == 422 and result.json()["code"] == code, result.text
        with SessionLocal() as s:
            assert (
                s.scalar(
                    select(func.count(EventCheckin.id)).where(
                        EventCheckin.event_id == uuid.UUID(event_ids[0])
                    )
                )
                == before
            )
            assert (
                s.scalar(
                    select(func.count(EventParticipant.id)).where(
                        EventParticipant.event_id == uuid.UUID(event_ids[0])
                    )
                )
                == participants_before
            )
    finally:
        app.dependency_overrides.pop(require_auth, None)
        with SessionLocal() as s:
            s.execute(delete(Event).where(Event.id.in_([uuid.UUID(x) for x in event_ids])))
            s.execute(delete(MonitoredArea).where(MonitoredArea.id == ids[2]))
            s.execute(delete(Profile).where(Profile.id.in_(ids[:2])))
            s.commit()
