"""Concurrent terminal follow-up regression coverage against local PostGIS."""

from __future__ import annotations

import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.api.routers import sightings
from app.core.security import AuthContext, require_auth
from app.db.base import SessionLocal
from app.db.models import AuditEvent, Profile, Sighting, SightingStatusEvent, Species
from app.main import app

pytestmark = pytest.mark.integration
if os.getenv("RUN_INVATRACE_IT3_POSTGIS") != "1":
    pytest.skip("set RUN_INVATRACE_IT3_POSTGIS=1 for local PostGIS", allow_module_level=True)


def test_terminal_follow_up_race_records_exactly_one_outcome(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The sighting row lock makes two terminal outcomes mutually exclusive."""
    monkeypatch.setattr(sightings.rate_limiter, "check", lambda *_args, **_kwargs: None)
    run = uuid.uuid4().hex[:12]
    species_id = f"followup-race-species-{run}"
    with SessionLocal() as session:
        profile = Profile(public_id=f"followup-race-{run}")
        species = Species(
            id=species_id,
            name="Follow-up race invasive",
            latin_name="Followup concurrentia",
            is_invasive=True,
            reportable=True,
        )
        sighting = Sighting(
            species_id=species_id,
            source_profile_id=None,
            status="removal_reported",
            follow_up_state="needed",
            risk="high",
            latitude=3.14,
            longitude=101.69,
            reporter_trust="Trusted",
            recommended_action="Observe safely.",
            place_label="Concurrency place",
        )
        # Sighting has no ORM relationship to Species, so make the FK parent
        # visible before flushing the dependent row.
        session.add_all((profile, species))
        session.flush()
        session.add(sighting)
        session.commit()
        profile_id, sighting_id = profile.id, sighting.id

    def auth_override() -> AuthContext:
        with SessionLocal() as session:
            profile = session.get(Profile, profile_id)
            assert profile is not None
            return AuthContext(profile=profile, installation=None)  # type: ignore[arg-type]

    app.dependency_overrides[require_auth] = auth_override
    barrier = Barrier(2)

    def submit(outcome: str) -> tuple[int, dict]:
        # Independent TestClient instances make distinct HTTP requests and DB
        # sessions.  Both wait until ready before getting a fresh GPS timestamp.
        with TestClient(app, raise_server_exceptions=False) as client:
            barrier.wait(timeout=10)
            response = client.post(
                f"/api/v1/sightings/{sighting_id}/follow-up",
                json={
                    "latitude": 3.14,
                    "longitude": 101.69,
                    "accuracyM": 10,
                    "capturedAt": datetime.now(UTC).isoformat(),
                    "outcome": outcome,
                },
            )
            return response.status_code, response.json()

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(submit, ("no_regrowth", "regrowth_present")))

        assert sorted(status for status, _ in results) == [201, 409]
        accepted = next(payload for status, payload in results if status == 201)
        rejected = next(payload for status, payload in results if status == 409)
        assert rejected["code"] == "follow_up_not_available"

        expected = {
            "no_regrowth": ("resolved_after_follow_up", "resolved", "followup_no_regrowth"),
            "regrowth_present": ("screened", "regrowth", "followup_regrowth"),
        }[accepted["outcome"]]
        with SessionLocal() as session:
            sighting = session.get(Sighting, sighting_id)
            assert sighting is not None
            assert (sighting.status, sighting.follow_up_state) == expected[:2]
            events = session.scalars(
                select(SightingStatusEvent).where(
                    SightingStatusEvent.sighting_id == sighting_id,
                    SightingStatusEvent.event_type != "removal_reported",
                )
            ).all()
            assert [event.event_type for event in events] == [expected[2]]
    finally:
        app.dependency_overrides.pop(require_auth, None)
        with SessionLocal() as session:
            session.execute(delete(AuditEvent).where(AuditEvent.subject_id == str(sighting_id)))
            session.execute(delete(SightingStatusEvent).where(SightingStatusEvent.sighting_id == sighting_id))
            session.execute(delete(Sighting).where(Sighting.id == sighting_id))
            session.execute(delete(Species).where(Species.id == species_id))
            session.execute(delete(Profile).where(Profile.id == profile_id))
            session.commit()
