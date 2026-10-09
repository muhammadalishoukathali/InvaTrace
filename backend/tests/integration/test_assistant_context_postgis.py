"""Public Map species lookup against the isolated PostGIS database; no inference."""

import os
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers.plant_assistant import router
from app.config import Settings, get_settings
from app.core.rate_limit import rate_limiter
from app.db.base import SessionLocal
from app.db.models import Sighting, Species

pytestmark = pytest.mark.integration
if os.getenv("RUN_INVATRACE_IT3_POSTGIS") != "1":
    pytest.skip("requires the dedicated isolated PostGIS database", allow_module_level=True)


def test_public_and_private_map_context_use_real_visibility_query(monkeypatch):
    monkeypatch.setattr(rate_limiter, "enabled", False)
    with SessionLocal() as session:
        if session.get(Species, "mikania-micrantha") is None:
            session.add(
                Species(
                    id="mikania-micrantha",
                    name="Mikania vine",
                    latin_name="Mikania micrantha",
                    is_invasive=True,
                    reportable=True,
                )
            )
            session.flush()
        rows = [
            Sighting(
                id=uuid.uuid4(),
                species_id="mikania-micrantha",
                status=status,
                risk="high",
                latitude=3.15,
                longitude=101.65,
                reporter_trust="New",
                recommended_action="Observe safely.",
                place_label="Isolated assistant context test",
            )
            for status in (
                "screened",
                "removal_reported",
                "resolved_after_follow_up",
                "candidate",
                "withdrawn",
                "rejected",
                "merged",
                "removed",
            )
        ]
        session.add_all(rows)
        session.commit()
        ids = [(str(row.id), row.status) for row in rows]
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None,
        assistant_generation_enabled=False,
        assistant_judge_enabled=False,
        assistant_generation_key=None,
        groq_api_key=None,
    )
    with TestClient(app) as client:
        for sighting_id, status in ids:
            result = client.post(
                "/api/v1/plant-assistant/map/ask",
                json={
                    "sightingId": sighting_id,
                    "question": "Where does it grow?",
                    "depth": "detailed",
                },
            )
            assert result.status_code == 200
            body = result.json()
            if status in {"screened", "removal_reported", "resolved_after_follow_up"}:
                assert body["status"] == "fallback" and body["sources"]
            else:
                assert body["status"] == "insufficient_evidence" and body["sources"] == []
            assert sighting_id not in body["answer"]
    # Fixtures remain only in this run's isolated database for evidence inspection.
