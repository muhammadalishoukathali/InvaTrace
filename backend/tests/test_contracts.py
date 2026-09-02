"""Contract tests between the frontend PWA and this API.

Checks the camelCase <-> snake_case boundary on ReportSubmission, that the
seeded species list actually matches the ONNX model's class catalog, and
that the OpenAPI schema still exposes the routes/headers the frontend
depends on. These are the tests most likely to catch a silent breaking
change before the frontend team notices.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.schemas import ReportSubmission, ReportSubmissionDetails, StartProfileRequest
from app.main import app
from app.seed import SPECIES


def valid_report() -> dict[str, object]:
    return {
        "photoKey": "photos/profile/photo.jpg",
        "speciesId": "mikania-micrantha",
        "outcome": "target",
        "confidence": 0.91,
        "modelVersion": "client-onnx-v1",
        "observedAt": datetime.now(UTC).isoformat(),
        "captureId": str(uuid.uuid4()),
        "captureSource": "camera",
        "location": {"lat": 3.139, "lng": 101.6869},
        "locationAccuracyM": 12,
        "extent": "single",
        "notes": "Near the trail marker",
        "consent": {"accurate": True, "noPII": True},
    }


def test_report_contract_uses_frontend_camel_case() -> None:
    # the frontend sends camelCase JSON, the Python side works in
    # snake_case internally - this just confirms the alias mapping goes
    # both ways (parse in, dump back out) without losing fields.
    parsed = ReportSubmission.model_validate(valid_report())
    assert parsed.species_id == "mikania-micrantha"
    assert parsed.model_dump(by_alias=True)["consent"]["noPII"] is True


def test_report_contract_accepts_gallery_and_rejects_unknown_capture_sources() -> None:
    # captureSource is a closed set (camera/gallery) - anything else should
    # get rejected at the schema level rather than falling through to
    # whatever downstream code does with an unrecognised value.
    gallery = valid_report()
    gallery["captureSource"] = "gallery"
    assert ReportSubmission.model_validate(gallery).capture_source == "gallery"

    invalid = valid_report()
    invalid["captureSource"] = "clipboard"
    with pytest.raises(ValidationError):
        ReportSubmission.model_validate(invalid)


def test_development_species_seed_exactly_matches_model_catalog() -> None:
    # this is the one I'd actually worry about breaking silently: the seed
    # data in app/seed.py has to line up 1:1 with the ONNX model's class
    # list, or predictions come back for species the API doesn't know
    # about. Comparing against the raw catalog json here rather than
    # trusting the seed module to be right.
    catalog_path = Path(__file__).parents[1] / "app/data/pulih_model1_species_31.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    expected_ids = {
        item["machine_label"].replace("_", "-") for item in catalog["classes"]
    }
    assert len(SPECIES) == catalog["class_count"] == 31
    assert {item["id"] for item in SPECIES} == expected_ids
    # AC 1.2.2 — three previously-invasive labels (miconia_crenata,
    # sphagneticola_trilobata, lantana_camara) were downgraded to
    # status_requires_expert_review because their only status source was
    # the model's own recognition category, which is not a Malaysian
    # invasive-status source. Every invasive species must expose Report.
    assert sum(bool(item["is_invasive"]) for item in SPECIES) == 13
    assert sum(bool(item["reportable"]) for item in SPECIES) == 13
    assert "clidemia-hirta" not in expected_ids


def test_target_requires_species_and_non_target_forbids_it() -> None:
    # outcome and speciesId are linked fields: "target" needs a species id,
    # anything else must NOT have one. Checking both directions since a
    # schema that only enforces one side is half-broken.
    target = valid_report()
    target["speciesId"] = None
    with pytest.raises(ValidationError):
        ReportSubmission.model_validate(target)

    other = valid_report()
    other["outcome"] = "other_plant"
    with pytest.raises(ValidationError):
        ReportSubmission.model_validate(other)


def test_stored_report_details_do_not_reapply_the_submission_window() -> None:
    # ReportSubmission (the create-time schema) enforces a "must be recent"
    # window on observedAt so people can't backdate reports. But once a
    # report is already stored, reading it back with the *Details variant
    # shouldn't re-validate that window - old reports need to stay
    # readable forever, not just for 30 days after they were made.
    stored = valid_report()
    stored["observedAt"] = (datetime.now(UTC) - timedelta(days=90)).isoformat()
    stored["speciesId"] = None
    stored["outcome"] = "uncertain"
    parsed = ReportSubmissionDetails.model_validate(stored)
    assert parsed.observed_at < datetime.now(UTC) - timedelta(days=30)


def test_identity_contract_rejects_privilege_injection() -> None:
    # StartProfileRequest is what an anonymous client sends to create a
    # profile - it should only ever carry installationToken. If role or
    # trustLevel leak through as accepted fields, a client could just ask
    # to be created as an Admin/Steward, which would be bad.
    with pytest.raises(ValidationError):
        StartProfileRequest.model_validate(
            {"installationToken": "A" * 43, "role": "Admin", "trustLevel": "Steward"}
        )


def test_openapi_contains_the_frontend_contract_and_required_idempotency_headers() -> None:
    # generated OpenAPI schema is basically the source of truth the
    # frontend codegens against, so this locks down the route list and
    # makes sure the old /api/v1/verify/* routes are actually gone (not
    # just unused) and that write endpoints still demand an
    # Idempotency-Key header rather than it quietly becoming optional.
    schema = app.openapi()
    required_paths = {
        "/health",
        "/api/v1/profiles/start",
        "/api/v1/profiles/bootstrap",
        "/api/v1/profiles/restore",
        "/api/v1/profiles/me",
        "/api/v1/species",
        "/api/v1/notifications",
        "/api/v1/uploads/presign",
        "/api/v1/reports",
        "/api/v1/reports/mine",
        "/api/v1/reports/{report_id}",
        "/api/v1/sightings",
        "/api/v1/admin/reports/{report_id}/repair",
    }
    assert required_paths.issubset(schema["paths"])
    assert not any(path.startswith("/api/v1/verify") for path in schema["paths"])
    for path in ("/api/v1/uploads/presign", "/api/v1/reports"):
        parameters = schema["paths"][path]["post"]["parameters"]
        header = next(item for item in parameters if item["name"] == "Idempotency-Key")
        assert header["required"] is True


def test_report_contract_accepts_image_sha256_hex() -> None:
    # AC release blocker — the frontend sends imageSha256 alongside every
    # report; ReportSubmission must accept it as an optional 64-char hex field.
    payload = valid_report()
    payload["imageSha256"] = "a" * 64
    parsed = ReportSubmission.model_validate(payload)
    assert parsed.image_sha256 == "a" * 64
    # Missing hash is still valid (client on old build, offline queue payload).
    del payload["imageSha256"]
    assert ReportSubmission.model_validate(payload).image_sha256 is None


def test_report_contract_rejects_malformed_image_sha256() -> None:
    payload = valid_report()
    payload["imageSha256"] = "not-a-hash"
    with pytest.raises(ValidationError):
        ReportSubmission.model_validate(payload)


def test_report_response_never_echoes_image_sha256() -> None:
    # AC 2.3.1 privacy — server must not expose the hash in report or
    # sighting responses. ReportSubmissionDetails (the response echo type)
    # must not carry the field.
    assert "image_sha256" not in ReportSubmissionDetails.model_fields
    assert "imageSha256" not in {
        f.alias for f in ReportSubmissionDetails.model_fields.values() if f.alias
    }


def test_openapi_exposes_guidance_and_scans_endpoints() -> None:
    # AC 3.1.1 + 2.2.1 — the canonical guidance endpoint and the scan
    # persistence endpoint both have to remain in the OpenAPI surface so
    # the frontend can rely on them.
    schema = TestClient(app).get("/openapi.json").json()
    assert "/api/v1/species/{species_id}/guidance" in schema["paths"]
    assert "/api/v1/scans" in schema["paths"]
    scan_post = schema["paths"]["/api/v1/scans"]["post"]
    request_schema_name = (
        scan_post["requestBody"]["content"]["application/json"]["schema"]["$ref"]
        .rsplit("/", 1)[-1]
    )
    scan_schema = schema["components"]["schemas"][request_schema_name]
    assert "captureSource" in scan_schema["properties"]


def test_openapi_sighting_response_includes_confidence_and_nearest_feature() -> None:
    # AC 4.2.2 + 4.3.1 — sighting responses expose the fields the detail
    # panel now renders directly.
    schema = TestClient(app).get("/openapi.json").json()
    sighting_schema = schema["components"]["schemas"]["SightingResponse"]
    assert "confidence" in sighting_schema["properties"]
    assert "nearestFeatureType" in sighting_schema["properties"]
    assert "nearestFeatureName" in sighting_schema["properties"]
    assert "nearestFeatureDistanceM" in sighting_schema["properties"]


def test_liveness_needs_no_external_dependency() -> None:
    # /health/live is the "is the process even up" probe - it must not
    # touch the DB/Redis/storage, otherwise a slow dependency takes down
    # the liveness check too and the orchestrator kills a container that's
    # actually fine. Readiness (DB/Redis/etc) is a separate endpoint.
    response = TestClient(app).get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-content-type-options"] == "nosniff"
