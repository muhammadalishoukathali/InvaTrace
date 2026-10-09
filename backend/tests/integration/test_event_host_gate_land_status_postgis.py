"""Real-PostGIS checks for the Epic 9 hosting gate and land-status event types.

AC 9.6.1: hosting unlocks after three non-rejected reports.
AC 9.6.6 / 9.6.7: the place's mapped protected-area status decides whether a
removal event may be hosted there; uncertain data fails closed.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func

from app.api.routers import events
from app.core.security import AuthContext, require_auth
from app.db.base import SessionLocal
from app.db.models import (
    Event,
    MonitoredArea,
    Profile,
    ProtectedArea,
    ProtectedAreaDataset,
    Report,
    Scan,
)
from app.main import app

pytestmark = pytest.mark.integration
if os.getenv("RUN_INVATRACE_IT3_POSTGIS") != "1":
    pytest.skip("set RUN_INVATRACE_IT3_POSTGIS=1 for local PostGIS", allow_module_level=True)


def _square(lon: float, lat: float, size: float = 0.01) -> str:
    return (
        f"SRID=4326;MULTIPOLYGON((({lon} {lat},{lon + size} {lat},{lon + size} {lat + size},"
        f"{lon} {lat + size},{lon} {lat})))"
    )


def _place(name: str, lon: float, lat: float, tags: dict[str, str]) -> MonitoredArea:
    return MonitoredArea(
        name=name,
        geometry=func.ST_GeogFromText(_square(lon, lat)),
        metadata_json={"geometry_status": "available", "geometry_version": "gate-v1", "tags": tags},
    )


def _report(profile_id: uuid.UUID, status: str, index: int, run: str) -> tuple[Scan, Report]:
    scan = Scan(
        profile_id=profile_id,
        capture_id=uuid.uuid4(),
        predicted_species_id="mikania-micrantha",
        outcome="target",
        confidence=0.9,
        model_version="test",
        capture_source="camera",
    )
    report = Report(
        profile_id=profile_id,
        species_id="mikania-micrantha",
        status=status,
        photo_key=f"gate/{run}/{index}",
        outcome="target",
        confidence=0.9,
        client_model_version="test",
        observed_at=datetime.now(UTC),
        capture_id=scan.capture_id,
        capture_source="camera",
        latitude=6.005,
        longitude=102.005,
        extent="single",
        consent_accurate=True,
        consent_no_pii=True,
        submitter_trust="New",
        idempotency_key=f"gate-{run}-{index}",
    )
    return scan, report


def test_hosting_gate_and_land_status_decide_event_types(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(events.rate_limiter, "check", lambda *_args, **_kwargs: None)
    # The gate ships switched off; this test covers it switched on.
    from app.config import get_settings

    enabled = get_settings().model_copy(update={"event_host_gate_enabled": True})
    monkeypatch.setattr(events, "get_settings", lambda: enabled)
    run, now = uuid.uuid4().hex[:10], datetime.now(UTC)
    with SessionLocal() as s:
        host = Profile(public_id=f"gate-host-{run}")
        # Coverage spans 102.00-102.10, 6.00-6.10; the uncovered place sits outside it.
        dataset = ProtectedAreaDataset(
            source=f"gate-test-{run}",
            version="gate-v1",
            updated_at=now + timedelta(days=3650),
            coverage_note="test coverage",
            coverage_geometry=func.ST_GeogFromText(_square(102.0, 6.0, 0.1)),
            active=True,
        )
        s.add_all((host, dataset))
        s.flush()
        s.add(
            ProtectedArea(
                dataset_id=dataset.id,
                source_feature_id=f"gate-{run}",
                name=f"Gate Reserve {run}",
                metadata_json={"tags": {"operator": "Test Forestry Department"}},
                geometry=func.ST_GeogFromText(_square(102.0, 6.0, 0.02)),
            )
        )
        protected = _place(f"Gate protected {run}", 102.005, 6.005, {"landuse": "forest"})
        open_land = _place(f"Gate open {run}", 102.05, 6.05, {"leisure": "park"})
        uncovered = _place(f"Gate uncovered {run}", 102.3, 6.3, {"leisure": "park"})
        tagged = _place(f"Gate tagged {run}", 102.07, 6.07, {"boundary": "national_park"})
        s.add_all((protected, open_land, uncovered, tagged))
        # Two counting reports plus one rejected: still below the gate.
        for index, status in enumerate(("screened", "processing", "rejected")):
            scan, report = _report(host.id, status, index, run)
            s.add(scan)
            s.flush()
            report.scan_id = scan.id
            s.add(report)
        s.commit()
        host_id, dataset_id = host.id, dataset.id
        places = {
            "protected": protected.id,
            "open": open_land.id,
            "uncovered": uncovered.id,
            "tagged": tagged.id,
        }

    def auth() -> AuthContext:
        with SessionLocal() as s:
            profile = s.get(Profile, host_id)
            assert profile
            return AuthContext(profile=profile, installation=None)  # type: ignore[arg-type]

    app.dependency_overrides[require_auth] = auth

    def payload(place: str, event_type: str, lat: float, lon: float) -> dict:
        return {
            "placeId": str(places[place]),
            "eventType": event_type,
            "title": f"{place} {event_type}",
            "purpose": "p",
            "safetyNotes": "Observe and report; hosting or joining grants no removal permission.",
            "meetingLatitude": lat,
            "meetingLongitude": lon,
            "startAt": (now + timedelta(minutes=10)).isoformat(),
            "endAt": (now + timedelta(hours=2)).isoformat(),
        }

    try:
        c = TestClient(app, raise_server_exceptions=False)
        eligibility = c.get("/api/v1/events/host-eligibility").json()
        assert eligibility == {"eligible": False, "report_count": 2, "required": 3}
        locked = c.post("/api/v1/events", json=payload("open", "survey", 6.055, 102.055))
        assert locked.status_code == 403
        assert locked.json()["code"] == "hosting_locked"

        with SessionLocal() as s:
            scan, report = _report(host_id, "merged", 3, run)
            s.add(scan)
            s.flush()
            report.scan_id = scan.id
            s.add(report)
            s.commit()
        assert c.get("/api/v1/events/host-eligibility").json()["eligible"] is True

        status = c.get(f"/api/v1/places/{places['protected']}/land-status").json()
        assert status["land_status"] == "protected"
        assert status["protected_area_name"] == f"Gate Reserve {run}"
        assert status["operator"] == "Test Forestry Department"
        assert "removal" not in status["allowed_event_types"]
        assert c.get(f"/api/v1/places/{places['open']}/land-status").json()["land_status"] == (
            "not_protected"
        )
        assert c.get(f"/api/v1/places/{places['uncovered']}/land-status").json()["land_status"] == (
            "uncertain"
        )
        assert c.get(f"/api/v1/places/{places['tagged']}/land-status").json()["land_status"] == (
            "protected"
        )

        for place, lat, lon in (
            ("protected", 6.01, 102.01),
            ("uncovered", 6.305, 102.305),
            ("tagged", 6.075, 102.075),
        ):
            refused = c.post("/api/v1/events", json=payload(place, "removal", lat, lon))
            assert refused.status_code == 422, (place, refused.text)
            assert refused.json()["code"] == "removal_not_allowed_here"

        survey = c.post("/api/v1/events", json=payload("protected", "survey", 6.01, 102.01))
        assert survey.status_code == 201, survey.text
        removal = c.post(
            "/api/v1/events",
            json={**payload("open", "removal", 6.055, 102.055), "permissionContext": "unknown"},
        )
        assert removal.status_code == 201, removal.text
        detail = c.get(f"/api/v1/events/{removal.json()['event_id']}").json()
        assert detail["land_status"] == "not_protected"
        assert detail["permission_context"] == "unknown"

        # Switching the survey on protected land to removal is refused.
        switched = c.patch(
            f"/api/v1/events/{survey.json()['event_id']}", json={"eventType": "removal"}
        )
        assert switched.status_code == 422
        assert switched.json()["code"] == "removal_not_allowed_here"

        # Publish re-checks land status: once the area becomes protected, the
        # removal draft can no longer go live.
        with SessionLocal() as s:
            s.add(
                ProtectedArea(
                    dataset_id=dataset_id,
                    source_feature_id=f"gate-late-{run}",
                    name=f"Gate Late Reserve {run}",
                    metadata_json={},
                    geometry=func.ST_GeogFromText(_square(102.045, 6.045, 0.02)),
                )
            )
            s.commit()
        published = c.patch(
            f"/api/v1/events/{removal.json()['event_id']}", json={"status": "published"}
        )
        assert published.status_code == 422
        assert published.json()["code"] == "removal_not_allowed_here"
    finally:
        app.dependency_overrides.pop(require_auth, None)
        with SessionLocal() as s:
            s.execute(delete(Event).where(Event.host_profile_id == host_id))
            s.execute(delete(Report).where(Report.profile_id == host_id))
            s.execute(delete(Scan).where(Scan.profile_id == host_id))
            s.execute(delete(MonitoredArea).where(MonitoredArea.id.in_(places.values())))
            s.execute(delete(ProtectedAreaDataset).where(ProtectedAreaDataset.id == dataset_id))
            s.execute(delete(Profile).where(Profile.id == host_id))
            s.commit()
