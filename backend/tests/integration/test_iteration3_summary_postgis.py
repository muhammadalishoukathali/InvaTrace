"""Opt-in PostGIS checks of filtered discovery, private state and factual summaries."""

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.routers import events
from app.core.security import AuthContext, require_auth
from app.db.base import SessionLocal, get_session
from app.db.models import Event, EventCheckin, MonitoredArea, Profile, Report, Scan
from app.main import app

pytestmark = pytest.mark.integration
if os.getenv("RUN_INVATRACE_IT3_POSTGIS") != "1":
    pytest.skip("set RUN_INVATRACE_IT3_POSTGIS=1 for local PostGIS", allow_module_level=True)


def test_scopes_summary_chat_and_identity_checkin(monkeypatch):
    monkeypatch.setattr(events.rate_limiter, "check", lambda *_args: None)
    now = datetime.now(UTC)
    # Endpoint commits release savepoints, while the outer transaction is rolled
    # back at the end. Nothing from this test survives in the demo database.
    connection = SessionLocal.kw["bind"].connect()
    outer = connection.begin()
    s = Session(bind=connection, join_transaction_mode="create_savepoint")
    host, viewer = (
        Profile(public_id=f"summary-host-{uuid.uuid4()}"),
        Profile(public_id=f"summary-viewer-{uuid.uuid4()}"),
    )
    places = [
        MonitoredArea(
            name=f"Summary place {uuid.uuid4()}",
            geometry=func.ST_GeogFromText(
                "SRID=4326;MULTIPOLYGON(((104 4,104.01 4,104.01 4.01,104 4.01,104 4)))"
            ),
            metadata_json={
                "geometry_status": "available",
                "geometry_version": "summary-v1",
                "tags": {"landuse": "forest"},
            },
        )
        for _ in range(2)
    ]
    s.add_all([host, viewer, *places])
    s.flush()

    def event(place, start, end, status="published", species=None, hidden=False):
        item = Event(
            host_profile_id=host.id,
            place_id=place.id,
            place_type="forest",
            event_type="survey",
            title="Summary survey",
            purpose="Observe",
            target_species_ids=species or [],
            meeting_latitude=4.005,
            meeting_longitude=104.005,
            start_at=start,
            end_at=end,
            status=status,
            hidden=hidden,
            permission_context="unknown",
            geometry_version="summary-v1",
            chat_link="https://example.org/community",
        )
        s.add(item)
        s.flush()
        return item

    active = event(
        places[0],
        now - timedelta(minutes=10),
        now + timedelta(hours=1),
        species=["mikania-micrantha"],
    )
    future = event(
        places[0],
        now + timedelta(days=1),
        now + timedelta(days=1, hours=2),
        species=["chromolaena-odorata"],
    )
    other = event(
        places[1],
        now + timedelta(days=2),
        now + timedelta(days=2, hours=1),
        species=["mikania-micrantha"],
    )
    completed = event(places[0], now - timedelta(hours=3), now - timedelta(hours=2), "completed")
    event(places[0], now + timedelta(days=3), now + timedelta(days=3, hours=1), "draft")
    event(places[0], now + timedelta(days=3), now + timedelta(days=3, hours=1), hidden=True)
    s.add(
        EventCheckin(
            event_id=active.id, profile_id=host.id, latitude=4.005, longitude=104.005, accuracy_m=10
        )
    )
    # Only three screened, in-window reports count; species are distinct values.
    for index, (status, species, capture) in enumerate(
        [
            ("screened", "mikania-micrantha", completed.start_at),
            ("screened", "mikania-micrantha", completed.end_at),
            ("screened", "chromolaena-odorata", completed.start_at),
            ("merged", "chromolaena-odorata", completed.start_at),
            ("screened", "chromolaena-odorata", completed.start_at - timedelta(seconds=1)),
        ]
    ):
        scan = Scan(
            profile_id=host.id,
            capture_id=uuid.uuid4(),
            predicted_species_id=species,
            outcome="target",
            confidence=0.9,
            model_version="test",
            capture_source="camera",
        )
        s.add(scan)
        s.flush()
        s.add(
            Report(
                profile_id=host.id,
                event_id=completed.id,
                captured_at=capture,
                species_id=species,
                status=status,
                photo_key=f"summary/{uuid.uuid4()}",
                outcome="target",
                confidence=0.9,
                client_model_version="test",
                observed_at=capture,
                capture_id=scan.capture_id,
                capture_source="camera",
                scan_id=scan.id,
                latitude=4.005,
                longitude=104.005,
                extent="single",
                consent_accurate=True,
                consent_no_pii=True,
                submitter_trust="New",
                idempotency_key=f"summary-{index}",
            )
        )
    s.commit()
    current = {"profile": viewer}
    app.dependency_overrides[get_session] = lambda: s
    app.dependency_overrides[require_auth] = lambda: AuthContext(
        profile=current["profile"], installation=None
    )
    try:
        c = TestClient(app, raise_server_exceptions=False)

        def ids(response):
            assert response.status_code == 200, response.text
            return {row["event_id"] for row in response.json()["items"]}

        bbox = "bbox=104,4,104.01,4.01"
        assert ids(c.get(f"/api/v1/events?{bbox}")) == {
            str(active.id),
            str(future.id),
            str(other.id),
        }
        assert ids(
            c.get(
                f"/api/v1/places/{places[0].id}/events?species_id=mikania-micrantha&species_id=chromolaena-odorata"
            )
        ) == {str(active.id), str(future.id)}
        assert ids(
            c.get(
                f"/api/v1/places/{places[0].id}/events",
                params={
                    "from": (now + timedelta(hours=2)).isoformat(),
                    "to": (now + timedelta(days=2)).isoformat(),
                },
            )
        ) == {str(future.id)}
        assert c.get("/api/v1/events?from=2030-01-01T00:00:00").status_code == 422
        detail = c.get(f"/api/v1/events/{active.id}").json()
        assert detail["last_checkin_at"] is None and detail["chat_link"] is None
        joined = c.post(f"/api/v1/events/{active.id}/participants")
        assert joined.status_code == 201
        assert (
            c.get(f"/api/v1/events/{active.id}").json()["chat_link"]
            == "https://example.org/community"
        )
        c.delete(f"/api/v1/events/{active.id}/participants/{joined.json()['participation_id']}")
        assert c.get(f"/api/v1/events/{active.id}").json()["chat_link"] is None
        summary = c.get(f"/api/v1/events/{completed.id}/summary")
        assert summary.status_code == 200, summary.text
        assert summary.json()["reports_submitted_count"] == 3
        assert summary.json()["distinct_species_count"] == 2
        assert summary.json()["next_event"]["event_id"] == str(future.id)
        assert set(summary.json()) == {
            "event_id",
            "reports_submitted_count",
            "distinct_species_count",
            "place_id",
            "place_name",
            "start_at",
            "end_at",
            "next_event",
        }
        completed.hidden = True
        s.commit()
        assert c.get(f"/api/v1/events/{completed.id}/summary").status_code == 404
        current["profile"] = host
        assert c.get(f"/api/v1/events/{completed.id}/summary").status_code == 200
        # Completion is terminal: a host cannot erase the factual summary by
        # cancelling the completed event.
        assert c.delete(f"/api/v1/events/{completed.id}").status_code == 409
        assert c.get(f"/api/v1/events/{completed.id}/summary").status_code == 200
        assert c.delete(f"/api/v1/events/{active.id}").status_code == 204
        assert (
            s.get(EventCheckin, s.query(EventCheckin.id).filter_by(event_id=active.id).scalar())
            is not None
        )
        assert c.get(f"/api/v1/events/{active.id}").json()["chat_link"] is None
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(require_auth, None)
        s.close()
        outer.rollback()
        connection.close()
