"""Opt-in HTTP integration checks for the Event API against local PostGIS.

Run only against the dedicated disposable ``invatrace_it3`` database:
``RUN_INVATRACE_IT3_POSTGIS=1 DATABASE_URL=... pytest ...``.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func

from app.core.security import AuthContext, require_auth
from app.db.base import SessionLocal
from app.db.models import Event, EventFlag, MonitoredArea, Profile, Species
from app.main import app

pytestmark = pytest.mark.integration

if os.getenv("RUN_INVATRACE_IT3_POSTGIS") != "1":
    pytest.skip(
        "set RUN_INVATRACE_IT3_POSTGIS=1 for the local dedicated PostGIS database",
        allow_module_level=True,
    )


def test_event_create_publish_discovery_and_private_host_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exercises the endpoint path with real PostGIS containment, not mocks."""
    from app.api.routers import events

    monkeypatch.setattr(events.rate_limiter, "check", lambda *_args, **_kwargs: None)
    run = uuid.uuid4().hex[:12]
    now = datetime.now(UTC)
    with SessionLocal() as session:
        host = Profile(public_id=f"event-host-{run}", display_name="Visible host")
        observer = Profile(public_id=f"event-observer-{run}", display_name=None)
        flaggers = [
            Profile(public_id=f"event-flag-{index}-{run}", display_name=None) for index in range(3)
        ]
        place = MonitoredArea(
            name=f"Event integration place {run}",
            geometry=func.ST_GeogFromText(
                "SRID=4326;MULTIPOLYGON(((101.000 3.000,101.010 3.000,101.010 3.010,101.000 3.010,101.000 3.000)))"
            ),
            metadata_json={
                "geometry_status": "available",
                "geometry_version": "events-it3-v1",
                "tags": {"landuse": "forest"},
            },
        )
        species_id = f"event-species-{run}"
        species = Species(
            id=species_id,
            name="Integration invasive",
            latin_name="Integration invasiva",
            is_invasive=True,
            reportable=True,
        )
        session.add_all((host, observer, *flaggers, place, species))
        session.commit()
        host_id, observer_id, place_id = host.id, observer.id, place.id
        flagger_ids = [profile.id for profile in flaggers]

    current = {"profile_id": host_id}

    def auth_override() -> AuthContext:
        with SessionLocal() as session:
            profile = session.get(Profile, current["profile_id"])
            assert profile is not None
            return AuthContext(profile=profile, installation=None)  # type: ignore[arg-type]

    app.dependency_overrides[require_auth] = auth_override
    try:
        client = TestClient(app, raise_server_exceptions=False)
        payload = {
            "placeId": str(place_id),
            "eventType": "survey",
            "title": "Native edge survey",
            "purpose": "Record community observations.",
            "targetSpeciesIds": [species_id],
            "meetingLatitude": 3.005,
            "meetingLongitude": 101.005,
            "startAt": (now + timedelta(minutes=10)).isoformat(),
            "endAt": (now + timedelta(hours=2)).isoformat(),
            "permissionContext": "unknown",
            "chatLink": "",
        }
        created = client.post("/api/v1/events", json=payload)
        assert created.status_code == 201, created.text
        event_id = created.json()["event_id"]
        published = client.patch(f"/api/v1/events/{event_id}", json={"status": "published"})
        assert published.status_code == 200, published.text
        assert published.json()["host_display_name"] == "Visible host"
        assert "event-host-" not in published.text

        discovery = client.get("/api/v1/events?bbox=101.000,3.000,101.010,3.010")
        assert discovery.status_code == 200
        assert [row["event_id"] for row in discovery.json()["items"]] == [event_id]
        filtered = client.get(f"/api/v1/events?species_id={species_id}")
        assert [row["event_id"] for row in filtered.json()["items"]] == [event_id]
        assert client.get("/api/v1/events?bbox=bad").status_code == 400

        # A different viewer sees a generic label when the host elected not to
        # have a display name; public_id is never serialised as a fallback.
        current["profile_id"] = observer_id
        detail = client.get(f"/api/v1/events/{event_id}")
        assert detail.status_code == 200
        assert detail.json()["host_display_name"] == "Visible host"
        assert "host_profile_id" not in detail.json()

        joined = client.post(f"/api/v1/events/{event_id}/participants")
        assert joined.status_code == 201, joined.text
        participation_id = joined.json()["participation_id"]
        # Joining twice is idempotent rather than creating a second identity row.
        assert (
            client.post(f"/api/v1/events/{event_id}/participants").json()["participation_id"]
            == participation_id
        )
        assert (
            client.delete(f"/api/v1/events/{event_id}/participants/{participation_id}").status_code
            == 204
        )
        assert client.post(f"/api/v1/events/{event_id}/participants").status_code == 201
        checked_in = client.post(
            f"/api/v1/events/{event_id}/check-in",
            json={
                "latitude": 3.005,
                "longitude": 101.005,
                "accuracyM": 15,
                "capturedAt": datetime.now(UTC).isoformat(),
            },
        )
        assert checked_in.status_code == 201, checked_in.text

        # A host cannot erase one or two reports before the three-identity
        # threshold hides the event.
        current["profile_id"] = flagger_ids[0]
        result = client.post(
            f"/api/v1/events/{event_id}/flag", json={"reason": "Concern 0"}
        )
        assert result.status_code == 202 and result.json()["hidden"] is False
        current["profile_id"] = host_id
        partial_restore = client.patch(f"/api/v1/events/{event_id}", json={"restore": True})
        assert partial_restore.status_code == 409
        with SessionLocal() as session:
            assert (
                session.query(EventFlag).filter(EventFlag.event_id == uuid.UUID(event_id)).count()
                == 1
            )

        for index, flagger_id in enumerate(flagger_ids[1:], start=1):
            current["profile_id"] = flagger_id
            result = client.post(
                f"/api/v1/events/{event_id}/flag", json={"reason": f"Concern {index}"}
            )
            assert result.status_code == 202, result.text
        assert result.json()["hidden"] is True
        assert client.get(f"/api/v1/events/{event_id}").status_code == 404
        current["profile_id"] = host_id
        restored = client.patch(f"/api/v1/events/{event_id}", json={"restore": True})
        assert restored.status_code == 200, restored.text
        assert restored.json()["hidden"] is False
        assert event_id in {item["event_id"] for item in client.get("/api/v1/events").json()["items"]}
    finally:
        app.dependency_overrides.pop(require_auth, None)
        with SessionLocal() as session:
            session.execute(delete(Event).where(Event.host_profile_id.in_((host_id, observer_id))))
            session.execute(delete(MonitoredArea).where(MonitoredArea.id == place_id))
            session.execute(delete(Species).where(Species.id == species_id))
            session.execute(
                delete(Profile).where(Profile.id.in_((host_id, observer_id, *flagger_ids)))
            )
            session.commit()
