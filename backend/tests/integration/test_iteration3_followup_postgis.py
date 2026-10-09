"""Real PostGIS coverage for the Epic 4 follow-up endpoint.

Run against the dedicated local ``invatrace_it3`` database only:
``RUN_INVATRACE_IT3_POSTGIS=1 DATABASE_URL=... pytest <this file>``.
"""
from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.api.routers import sightings
from app.core.security import AuthContext, require_auth
from app.db.base import SessionLocal
from app.db.models import AuditEvent, Profile, Sighting, SightingStatusEvent, Species
from app.main import app

pytestmark = pytest.mark.integration
if os.getenv("RUN_INVATRACE_IT3_POSTGIS") != "1":
    pytest.skip("set RUN_INVATRACE_IT3_POSTGIS=1 for local PostGIS", allow_module_level=True)


def test_follow_up_outcomes_filters_history_and_rejections_are_atomic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sightings.rate_limiter, "check", lambda *_args, **_kwargs: None)
    run = uuid.uuid4().hex[:12]
    now = datetime.now(UTC)
    species_id = f"followup-species-{run}"
    with SessionLocal() as session:
        profile = Profile(public_id=f"followup-{run}")
        species = Species(
            id=species_id, name="Follow-up invasive", latin_name="Followup invasiva",
            is_invasive=True, reportable=True,
        )
        rows = [
            Sighting(
                species_id=species_id, source_profile_id=None, status="removal_reported",
                follow_up_state="needed", risk="high", latitude=3.14 + index / 100,
                longitude=101.69 + index / 100, reporter_trust="Trusted",
                recommended_action="Observe safely.", place_label="Integration place",
            )
            for index in range(6)
        ]
        # There is no ORM relationship from Sighting to Species, so make the
        # catalogue parent visible before flushing the dependent sightings.
        session.add_all((profile, species))
        session.flush()
        session.add_all(rows)
        session.flush()
        # A removal-reported sighting has a separate original-removal event.
        # This also proves that public history retains its date/type while
        # excluding the protected coordinates held by the event table.
        session.add_all(
            SightingStatusEvent(
                sighting_id=row.id,
                report_id=None,
                acting_profile_id=profile.id,
                event_type="removal_reported",
                latitude=row.latitude,
                longitude=row.longitude,
                accuracy_m=10,
                distance_m=0,
                created_at=now - timedelta(days=1),
            )
            for row in rows
        )
        session.commit()
        profile_id, sighting_ids = profile.id, [row.id for row in rows]

    def auth_override() -> AuthContext:
        with SessionLocal() as session:
            profile = session.get(Profile, profile_id)
            assert profile is not None
            return AuthContext(profile=profile, installation=None)  # type: ignore[arg-type]

    app.dependency_overrides[require_auth] = auth_override
    client = TestClient(app, raise_server_exceptions=False)

    def payload(index: int, outcome: str, **overrides: object) -> dict[str, object]:
        return {
            "latitude": 3.14 + index / 100,
            "longitude": 101.69 + index / 100,
            "accuracyM": 10,
            "capturedAt": now.isoformat(),
            "outcome": outcome,
            **overrides,
        }

    try:
        no_regrowth = client.post(
            f"/api/v1/sightings/{sighting_ids[0]}/follow-up", json=payload(0, "no_regrowth"),
        )
        assert no_regrowth.status_code == 201, no_regrowth.text
        assert no_regrowth.json()["followUpState"] == "resolved"

        regrowth = client.post(
            f"/api/v1/sightings/{sighting_ids[1]}/follow-up", json=payload(1, "regrowth_present"),
        )
        assert regrowth.status_code == 201, regrowth.text
        assert regrowth.json()["followUpState"] == "regrowth"

        unable = client.post(
            f"/api/v1/sightings/{sighting_ids[2]}/follow-up", json=payload(2, "unable_to_confirm"),
        )
        assert unable.status_code == 201, unable.text
        assert unable.json()["followUpState"] == "needed"
        assert unable.json()["lastFollowupAt"]

        with SessionLocal() as session:
            assert session.get(Sighting, sighting_ids[0]).status == "resolved_after_follow_up"
            assert session.get(Sighting, sighting_ids[1]).status == "screened"
            retained = session.get(Sighting, sighting_ids[2])
            assert retained is not None and retained.status == "removal_reported"
            assert retained.last_followup_at is not None
            follow_up_events = session.scalars(
                select(SightingStatusEvent).where(
                    SightingStatusEvent.sighting_id.in_(sighting_ids[:3]),
                    SightingStatusEvent.event_type != "removal_reported",
                )
            ).all()
            assert len(follow_up_events) == 3
            assert all(event.report_id is None for event in follow_up_events)

        default_ids = {item["id"] for item in client.get("/api/v1/sightings").json()["items"]}
        resolved_ids = {
            item["id"] for item in client.get("/api/v1/sightings?follow_up=resolved").json()["items"]
        }
        assert str(sighting_ids[0]) not in default_ids
        assert str(sighting_ids[0]) in resolved_ids
        assert str(sighting_ids[1]) in {
            item["id"] for item in client.get("/api/v1/sightings?follow_up=regrowth").json()["items"]
        }
        assert str(sighting_ids[2]) in {
            item["id"] for item in client.get("/api/v1/sightings?follow_up=needed").json()["items"]
        }

        # Add a second attempt only where it is valid; history stays public
        # only as type/date records, in append-only chronological order.
        assert client.post(
            f"/api/v1/sightings/{sighting_ids[2]}/follow-up", json=payload(2, "unable_to_confirm"),
        ).status_code == 201
        detail = client.get(f"/api/v1/sightings/{sighting_ids[2]}")
        assert detail.status_code == 200
        history = detail.json()["followUpHistory"]
        assert [entry["eventType"] for entry in history] == [
            "reported", "removal_reported", "followup_unable", "followup_unable"
        ]
        assert all(set(entry) == {"eventType", "createdAt"} for entry in history)
        # The original report leads; the status events after it are in date order.
        status_dates = [entry["createdAt"] for entry in history[1:]]
        assert status_dates == sorted(status_dates)

        for index, bad_payload, code in (
            (3, payload(3, "unable_to_confirm", capturedAt=(now - timedelta(minutes=6)).isoformat()), "follow_up_location_stale"),
            (4, payload(4, "unable_to_confirm", accuracyM=250.01), "follow_up_accuracy_too_low"),
            (5, payload(5, "unable_to_confirm", latitude=3.14, longitude=101.69), "follow_up_too_far"),
        ):
            with SessionLocal() as session:
                before = session.scalar(
                    select(func.count(SightingStatusEvent.id)).where(
                        SightingStatusEvent.sighting_id == sighting_ids[index]
                    )
                )
            response = client.post(f"/api/v1/sightings/{sighting_ids[index]}/follow-up", json=bad_payload)
            assert response.status_code == 422 and response.json()["code"] == code
            with SessionLocal() as session:
                assert session.scalar(
                    select(func.count(SightingStatusEvent.id)).where(
                        SightingStatusEvent.sighting_id == sighting_ids[index]
                    )
                ) == before
                unchanged = session.get(Sighting, sighting_ids[index])
                assert unchanged is not None and unchanged.follow_up_state == "needed"
                assert unchanged.last_followup_at is None

        with SessionLocal() as session:
            audits = session.scalars(
                select(AuditEvent).where(
                    AuditEvent.subject_id.in_([str(value) for value in sighting_ids[:3]])
                )
            ).all()
            assert len(audits) == 4
            assert all(audit.acting_profile_id == profile_id for audit in audits)
            assert all(
                "latitude" not in audit.metadata_json and "longitude" not in audit.metadata_json
                for audit in audits
            )
    finally:
        app.dependency_overrides.pop(require_auth, None)
        with SessionLocal() as session:
            session.execute(delete(AuditEvent).where(AuditEvent.subject_id.in_([str(value) for value in sighting_ids])))
            session.execute(delete(SightingStatusEvent).where(SightingStatusEvent.sighting_id.in_(sighting_ids)))
            session.execute(delete(Sighting).where(Sighting.id.in_(sighting_ids)))
            session.execute(delete(Species).where(Species.id == species_id))
            session.execute(delete(Profile).where(Profile.id == profile_id))
            session.commit()


def test_removal_can_be_reported_again_after_regrowth(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC 4.8.5: removal -> regrowth -> removal again restarts follow-up on PostGIS."""
    from decimal import Decimal

    from app.db.models import Report, ReportSightingLink, Scan

    monkeypatch.setattr(sightings.rate_limiter, "check", lambda *_a, **_k: None)
    run = uuid.uuid4().hex[:12]
    now = datetime.now(UTC)
    species_id = f"reremoval-species-{run}"
    lat, lng = Decimal("3.15000"), Decimal("101.70000")
    with SessionLocal() as session:
        profile = Profile(public_id=f"reremoval-{run}")
        species = Species(
            id=species_id, name="Re-removal invasive", latin_name="Reremoval invasiva",
            is_invasive=True, reportable=True,
        )
        session.add_all((profile, species))
        session.flush()
        scan = Scan(
            profile_id=profile.id, capture_id=uuid.uuid4(), predicted_species_id=species_id,
            outcome="target", confidence=Decimal("0.9"), model_version="test", capture_source="camera",
        )
        sighting = Sighting(
            species_id=species_id, source_profile_id=None, status="screened", risk="high",
            latitude=lat, longitude=lng, reporter_trust="Trusted",
            recommended_action="Observe safely.", place_label="Integration place",
        )
        session.add_all((scan, sighting))
        session.flush()
        report = Report(
            profile_id=profile.id, species_id=species_id, status="screened",
            photo_key=f"reremoval/{run}.jpg", outcome="target", confidence=Decimal("0.9"),
            client_model_version="test", observed_at=now, capture_id=scan.capture_id,
            capture_source="camera", scan_id=scan.id, latitude=lat, longitude=lng,
            location_accuracy_m=8, extent="single", notes="", consent_accurate=True,
            consent_no_pii=True, submitter_trust="Trusted", idempotency_key=f"reremoval-{run}",
        )
        session.add(report)
        session.flush()
        session.add(ReportSightingLink(report_id=report.id, sighting_id=sighting.id, active=True))
        session.commit()
        profile_id, sighting_id, report_id = profile.id, sighting.id, report.id

    def auth_override() -> AuthContext:
        with SessionLocal() as session:
            profile = session.get(Profile, profile_id)
            assert profile is not None
            return AuthContext(profile=profile, installation=None)  # type: ignore[arg-type]

    app.dependency_overrides[require_auth] = auth_override
    client = TestClient(app, raise_server_exceptions=False)
    fix = {"latitude": float(lat), "longitude": float(lng), "accuracyM": 10}

    def remove():
        return client.post(
            f"/api/v1/reports/{report_id}/removal",
            json={**fix, "capturedAt": datetime.now(UTC).isoformat()},
        )

    def follow_up(outcome: str):
        return client.post(
            f"/api/v1/sightings/{sighting_id}/follow-up",
            json={**fix, "capturedAt": datetime.now(UTC).isoformat(), "outcome": outcome},
        )

    def detail() -> dict:
        return client.get(f"/api/v1/sightings/{sighting_id}").json()

    try:
        first = remove()
        assert first.status_code == 200, first.text
        # A repeat while the removal is still open replays it without a new event.
        replay = remove()
        assert replay.status_code == 200 and replay.json()["removalReportedAt"] == first.json()["removalReportedAt"]
        assert follow_up("regrowth_present").status_code == 201
        assert detail()["followUpState"] == "regrowth"
        assert detail()["removalReportId"] == str(report_id)

        second = remove()
        assert second.status_code == 200, second.text
        assert second.json()["removalReportedAt"] != first.json()["removalReportedAt"]
        after = detail()
        assert after["status"] == "removal_reported" and after["followUpState"] == "needed"
        assert after["reportCount"] == 1
        assert [e["eventType"] for e in after["followUpHistory"]] == [
            "reported", "removal_reported", "followup_regrowth", "removal_reported",
        ]
        assert after["removalReportedAt"] == second.json()["removalReportedAt"]

        # The restarted cycle can run to resolution; a resolved sighting cannot be removed again.
        assert follow_up("no_regrowth").status_code == 201
        assert remove().status_code == 409
    finally:
        app.dependency_overrides.pop(require_auth, None)
        with SessionLocal() as session:
            session.execute(delete(SightingStatusEvent).where(SightingStatusEvent.sighting_id == sighting_id))
            session.execute(delete(AuditEvent).where(AuditEvent.subject_id == str(sighting_id)))
            session.execute(delete(ReportSightingLink).where(ReportSightingLink.sighting_id == sighting_id))
            session.execute(delete(Report).where(Report.id == report_id))
            session.execute(delete(Sighting).where(Sighting.id == sighting_id))
            session.execute(delete(Scan).where(Scan.profile_id == profile_id))
            session.execute(delete(AuditEvent).where(AuditEvent.subject_id == str(report_id)))
            session.execute(delete(Profile).where(Profile.id == profile_id))
            session.execute(delete(Species).where(Species.id == species_id))
            session.commit()
