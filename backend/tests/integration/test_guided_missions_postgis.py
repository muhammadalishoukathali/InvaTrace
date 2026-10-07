"""Real-PostGIS checks for Epic 7 guided missions and their report/scan links.

Opt-in like the other IT3 modules: only intended for the disposable local
PostGIS database migrated to head. Object storage is the sole mocked boundary.
"""

from __future__ import annotations

import hashlib
import os
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, update

from app.api.routers import reports
from app.core.security import AuthContext, require_auth
from app.db.base import SessionLocal
from app.db.models import (
    GuidedMission,
    MonitoredArea,
    Profile,
    Report,
    Scan,
    UploadGrant,
    VerificationJob,
)
from app.main import app

pytestmark = pytest.mark.integration

if os.getenv("RUN_INVATRACE_IT3_POSTGIS") != "1":
    pytest.skip("set RUN_INVATRACE_IT3_POSTGIS=1 for local PostGIS", allow_module_level=True)

JPEG = b"\xff\xd8" + b"guided-mission-integration" * 64 + b"\xff\xd9"
SPECIES = "mikania-micrantha"


def test_guided_mission_links_reports_and_scans(monkeypatch: pytest.MonkeyPatch) -> None:
    run = uuid.uuid4().hex[:12]
    now = datetime.now(UTC)
    with SessionLocal() as session:
        owner = Profile(public_id=f"mission-owner-{run}", display_name="Mission owner")
        other = Profile(public_id=f"mission-other-{run}", display_name="Mission other")
        place = MonitoredArea(
            name=f"Mission place {run}",
            geometry=func.ST_GeogFromText(
                "SRID=4326;MULTIPOLYGON(((101.100 3.100,101.110 3.100,101.110 3.110,101.100 3.110,101.100 3.100)))"
            ),
            metadata_json={
                "geometry_status": "available",
                "geometry_version": "missions-it3-v1",
                "tags": {"leisure": "park"},
            },
        )
        session.add_all((owner, other, place))
        session.commit()
        owner_id, other_id, place_id = owner.id, other.id, place.id

    monkeypatch.setattr(reports.rate_limiter, "check", lambda *_args, **_kwargs: None)
    uploaded: dict[str, bytes] = {}
    monkeypatch.setattr(
        reports.storage,
        "head",
        lambda key: SimpleNamespace(size_bytes=len(uploaded[key]), content_type="image/jpeg"),
    )
    monkeypatch.setattr(reports.storage, "get_bytes", lambda key: uploaded[key])
    monkeypatch.setattr(reports.storage, "finalize_upload", lambda *_args, **_kwargs: None)
    current = {"profile": owner_id}

    def auth_override() -> AuthContext:
        with SessionLocal() as session:
            profile = session.get(Profile, current["profile"])
            assert profile is not None
            return AuthContext(profile=profile, installation=None)  # type: ignore[arg-type]

    app.dependency_overrides[require_auth] = auth_override

    def submission(profile_id: uuid.UUID, suffix: str, **extra) -> dict:
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
                    predicted_species_id=SPECIES,
                    outcome="target",
                    confidence=0.9,
                    model_version="integration-v1",
                    image_sha256=hashlib.sha256(image_bytes).digest(),
                    capture_source="gallery",
                )
            )
            session.commit()
        return {
            "photoKey": key,
            "speciesId": SPECIES,
            "outcome": "target",
            "confidence": 0.9,
            "modelVersion": "integration-v1",
            "observedAt": now.isoformat(),
            "captureId": str(capture_id),
            "captureSource": "gallery",
            "location": {"lat": 3.105, "lng": 101.105},
            "locationAccuracyM": 10,
            "extent": "single",
            "notes": "",
            "consent": {"accurate": True, "noPII": True},
            "imageSha256": hashlib.sha256(image_bytes).hexdigest(),
            **extra,
        }

    try:
        client = TestClient(app, raise_server_exceptions=False)
        created = client.post(
            "/api/v1/guided-missions",
            json={
                "placeId": str(place_id),
                "watchlistSpeciesIds": [SPECIES],
                "datasetVersion": "it3",
            },
        )
        assert created.status_code == 201, created.text
        mission_id = created.json()["missionId"]
        again = client.post(
            "/api/v1/guided-missions",
            json={
                "placeId": str(place_id),
                "watchlistSpeciesIds": [SPECIES],
                "datasetVersion": "it3",
            },
        )
        assert again.status_code == 200 and again.json()["missionId"] == mission_id
        unknown_place = client.post(
            "/api/v1/guided-missions",
            json={
                "placeId": str(uuid.uuid4()),
                "watchlistSpeciesIds": [SPECIES],
                "datasetVersion": "it3",
            },
        )
        assert unknown_place.json()["code"] == "place_not_found"

        # Valid mission: stored on the report row and echoed in the response.
        accepted = submission(owner_id, "accepted", missionId=mission_id)
        response = client.post(
            "/api/v1/reports", json=accepted, headers={"Idempotency-Key": f"mission-ok-{run}"}
        )
        assert response.status_code == 201, response.text
        assert response.json()["missionId"] == mission_id
        assert response.json()["submission"]["missionId"] == mission_id
        assert response.json()["submission"]["captureSource"] == "gallery"
        report_id = uuid.UUID(response.json()["id"])
        with SessionLocal() as session:
            assert session.scalar(select(Report.mission_id).where(Report.id == report_id)) == (
                uuid.UUID(mission_id)
            )

        # Another profile's mission: 422 and no report row for that capture.
        current["profile"] = other_id
        foreign = submission(other_id, "foreign", missionId=mission_id)
        response = client.post(
            "/api/v1/reports", json=foreign, headers={"Idempotency-Key": f"mission-bad-{run}"}
        )
        assert response.status_code == 422 and response.json()["code"] == "mission_invalid"
        with SessionLocal() as session:
            assert (
                session.scalar(
                    select(func.count(Report.id)).where(
                        Report.capture_id == uuid.UUID(foreign["captureId"])
                    )
                )
                == 0
            )
            grant = session.scalar(
                select(UploadGrant).where(UploadGrant.object_key == foreign["photoKey"])
            )
            assert grant.consumed_at is None
        scan = client.post(
            "/api/v1/scans",
            json={
                "captureId": str(uuid.uuid4()),
                "outcome": "uncertain",
                "confidence": 0.3,
                "modelVersion": "integration-v1",
                "captureSource": "gallery",
                "missionId": mission_id,
            },
        )
        assert scan.status_code == 422 and scan.json()["code"] == "mission_invalid"
        forbidden = client.get(f"/api/v1/guided-missions/{mission_id}")
        assert forbidden.status_code == 403 and forbidden.json()["code"] == "not_mission_owner"

        current["profile"] = owner_id
        scan = client.post(
            "/api/v1/scans",
            json={
                "captureId": str(uuid.uuid4()),
                "outcome": "uncertain",
                "confidence": 0.3,
                "modelVersion": "integration-v1",
                "captureSource": "gallery",
                "missionId": mission_id,
            },
        )
        assert scan.status_code == 201, scan.text
        assert scan.json()["captureSource"] == "gallery"
        assert scan.json()["missionId"] == mission_id

        rejected = submission(owner_id, "rejected", missionId=mission_id)
        response = client.post(
            "/api/v1/reports", json=rejected, headers={"Idempotency-Key": f"mission-rej-{run}"}
        )
        assert response.status_code == 201, response.text
        with SessionLocal() as session:
            session.execute(
                update(Report)
                .where(Report.id == uuid.UUID(response.json()["id"]))
                .values(status="rejected")
            )
            session.commit()

        # A plant with a submitted sighting cannot also record a no-find.
        no_find = client.put(
            f"/api/v1/guided-missions/{mission_id}/plants/{SPECIES}",
            json={"state": "looked_for", "noTargetFound": True},
        )
        assert no_find.status_code == 409 and no_find.json()["code"] == "sighting_already_submitted"
        looked = client.put(
            f"/api/v1/guided-missions/{mission_id}/plants/{SPECIES}",
            json={"state": "looked_for", "noTargetFound": False},
        )
        assert looked.status_code == 200, looked.text
        summary = client.post(f"/api/v1/guided-missions/{mission_id}/complete")
        assert summary.status_code == 200, summary.text
        data = summary.json()
        assert data["status"] == "completed"
        assert data["reportsSubmittedCount"] == 1
        assert [item["reportId"] for item in data["reports"]] == [str(report_id)]
        assert data["scansCount"] == 1
        assert (data["lookedForCount"], data["noTargetFoundCount"]) == (1, 0)

        # Completed missions accept no new links.
        late = submission(owner_id, "late", missionId=mission_id)
        response = client.post(
            "/api/v1/reports", json=late, headers={"Idempotency-Key": f"mission-late-{run}"}
        )
        assert response.status_code == 422 and response.json()["code"] == "mission_invalid"
    finally:
        app.dependency_overrides.pop(require_auth, None)
        with SessionLocal() as session:
            profiles = (owner_id, other_id)
            report_ids = select(Report.id).where(Report.profile_id.in_(profiles))
            session.execute(
                delete(VerificationJob).where(VerificationJob.report_id.in_(report_ids))
            )
            session.execute(delete(UploadGrant).where(UploadGrant.profile_id.in_(profiles)))
            session.execute(delete(Report).where(Report.profile_id.in_(profiles)))
            session.execute(delete(Scan).where(Scan.profile_id.in_(profiles)))
            session.execute(delete(GuidedMission).where(GuidedMission.profile_id.in_(profiles)))
            session.execute(delete(MonitoredArea).where(MonitoredArea.id == place_id))
            session.commit()
