"""Epic 7 guided habitat search missions - API behaviour without PostGIS.

The mission tables contain no spatial columns, so the router runs against an
in-memory SQLite copy of exactly the tables it touches (spatial columns and
PostgreSQL-only constraints stripped). Place resolution - the only PostGIS
dependency - is replaced with an in-memory lookup. The full report/scan
submission path is exercised against real PostGIS in
tests/integration/test_guided_missions_postgis.py.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from geoalchemy2 import Geography, Geometry
from pydantic import ValidationError
from sqlalchemy import (
    CheckConstraint,
    Column,
    Index,
    MetaData,
    Table,
    UniqueConstraint,
    create_engine,
    event,
    insert,
    select,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routers import guided_missions, reports, scans
from app.api.schemas import ReportResponse, ReportSubmission, ScanCreateRequest
from app.core.errors import ApiProblem
from app.core.security import require_auth
from app.db.base import get_session
from app.db.models import (
    GuidedMission,
    GuidedMissionPlantProgress,
    Report,
    ReportSightingLink,
    Scan,
    Sighting,
    Species,
)
from app.main import app
from app.services.guided_missions import validate_mission_link

SPECIES = ("mikania-micrantha", "lantana-camara", "chromolaena-odorata")
# Mission tables keep their real CHECK constraints and partial unique index so
# the SQLite copy enforces the same invariants as the Alembic migration.
KEEP_CONSTRAINTS = {"guided_missions", "guided_mission_plant_progress"}


def _sqlite_copy(table: Table, metadata: MetaData) -> Table:
    columns = []
    for column in table.columns:
        if isinstance(column.type, Geography | Geometry):
            continue
        columns.append(
            Column(
                column.name,
                column.type,
                primary_key=column.primary_key,
                nullable=not column.primary_key,
                server_default=column.server_default if column.computed is None else None,
            )
        )
    extras = []
    if table.name in KEEP_CONSTRAINTS:
        for constraint in table.constraints:
            if isinstance(constraint, CheckConstraint):
                extras.append(CheckConstraint(constraint.sqltext, name=constraint.name))
            elif isinstance(constraint, UniqueConstraint):
                extras.append(
                    UniqueConstraint(*[c.name for c in constraint.columns], name=constraint.name)
                )
    copy = Table(table.name, metadata, *columns, *extras)
    if table.name in KEEP_CONSTRAINTS:
        for index in table.indexes:
            Index(
                index.name,
                *[copy.c[c.name] for c in index.columns],
                unique=index.unique,
                sqlite_where=index.dialect_options["sqlite"].get("where"),
            )
    return copy


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def _functions(connection, _record):
        # geoalchemy2 wraps spatial columns in ST_AsEWKB when an ORM entity is
        # loaded; spatial columns are absent here so the identity is enough.
        connection.create_function("ST_AsEWKB", 1, lambda value: value)
        connection.create_function("AsEWKB", 1, lambda value: value)

    metadata = MetaData()
    for model in (
        Species,
        GuidedMission,
        GuidedMissionPlantProgress,
        Scan,
        Report,
        ReportSightingLink,
        Sighting,
    ):
        _sqlite_copy(model.__table__, metadata)
    metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    with factory() as session:
        session.execute(insert(Species.__table__), [{"id": s} for s in SPECIES])
        session.commit()
    return factory


@pytest.fixture
def place_id(monkeypatch):
    known = uuid.uuid4()

    def fake_place(_session, value):
        if value != known:
            raise ApiProblem(404, "place_not_found", "Not found")
        return SimpleNamespace(id=known, name="Test park"), "park"

    monkeypatch.setattr(guided_missions, "_place", fake_place)
    return known


@pytest.fixture
def identities(db, monkeypatch):
    owner, other = uuid.uuid4(), uuid.uuid4()
    current = {"profile": owner}

    def session_override():
        session = db()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[require_auth] = lambda: SimpleNamespace(
        profile=SimpleNamespace(id=current["profile"], trust_level="New"), installation=None
    )
    monkeypatch.setattr(guided_missions.rate_limiter, "check", lambda *_a, **_k: None)
    try:
        yield SimpleNamespace(owner=owner, other=other, current=current)
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(require_auth, None)


@pytest.fixture
def client(identities):
    return TestClient(app, raise_server_exceptions=False)


def _create(client, place_id, species=SPECIES, version="catalogue-2026.10"):
    return client.post(
        "/api/v1/guided-missions",
        json={
            "placeId": str(place_id),
            "watchlistSpeciesIds": list(species),
            "datasetVersion": version,
        },
    )


def test_create_returns_201_then_resumes_same_mission_with_200(client, place_id):
    first = _create(client, place_id, species=[*SPECIES, SPECIES[0]])
    assert first.status_code == 201, first.text
    body = first.json()
    assert set(body) == {
        "missionId",
        "placeId",
        "status",
        "datasetVersion",
        "selectedSpeciesId",
        "startedAt",
        "updatedAt",
        "completedAt",
        "plants",
        "scansCount",
        "reports",
    }
    assert body["status"] == "active" and body["completedAt"] is None
    assert body["placeId"] == str(place_id)
    assert body["datasetVersion"] == "catalogue-2026.10"
    # Duplicates collapse to one progress row each, in watchlist order.
    assert [p["speciesId"] for p in body["plants"]] == list(SPECIES)
    assert {(p["state"], p["noTargetFound"]) for p in body["plants"]} == {("not_checked", False)}
    assert set(body["plants"][0]) == {"speciesId", "state", "noTargetFound", "updatedAt"}
    assert body["scansCount"] == 0 and body["reports"] == []

    second = _create(client, place_id, species=SPECIES[:1])
    assert second.status_code == 200
    assert second.json()["missionId"] == body["missionId"]
    assert len(second.json()["plants"]) == len(SPECIES)


def test_create_validation_codes(client, place_id):
    assert _create(client, uuid.uuid4()).json()["code"] == "place_not_found"
    assert _create(client, uuid.uuid4()).status_code == 422
    empty = _create(client, place_id, species=[])
    assert (empty.status_code, empty.json()["code"]) == (422, "empty_watchlist")
    unknown = _create(client, place_id, species=["not-a-plant"])
    assert (unknown.status_code, unknown.json()["code"]) == (422, "unknown_species")
    too_many = _create(client, place_id, species=[f"s{i}" for i in range(65)])
    assert too_many.status_code == 422
    assert _create(client, place_id, version="").status_code == 422
    assert _create(client, place_id, version="v" * 81).status_code == 422
    missing = client.post(
        "/api/v1/guided-missions",
        json={"placeId": str(place_id), "watchlistSpeciesIds": list(SPECIES)},
    )
    assert missing.status_code == 422
    # A client-supplied profile id is never accepted.
    smuggled = client.post(
        "/api/v1/guided-missions",
        json={
            "placeId": str(place_id),
            "watchlistSpeciesIds": list(SPECIES),
            "datasetVersion": "v1",
            "profileId": str(uuid.uuid4()),
        },
    )
    assert smuggled.status_code == 422


def test_another_profile_gets_403_on_every_mission_route(client, identities, place_id):
    mission_id = _create(client, place_id).json()["missionId"]
    identities.current["profile"] = identities.other
    base = f"/api/v1/guided-missions/{mission_id}"
    calls = [
        client.get(base),
        client.get(f"{base}/summary"),
        client.patch(base, json={"selectedSpeciesId": None}),
        client.put(f"{base}/plants/{SPECIES[0]}", json={"state": "looked_for"}),
        client.post(f"{base}/complete"),
    ]
    for response in calls:
        assert (response.status_code, response.json()["code"]) == (403, "not_mission_owner")
    # The other profile's active lookup is scoped to its own missions.
    lookup = client.get("/api/v1/guided-missions/active", params={"place_id": str(place_id)})
    assert (lookup.status_code, lookup.json()["code"]) == (404, "mission_not_found")
    # And it can start its own mission at the same place.
    assert _create(client, place_id).status_code == 201
    identities.current["profile"] = identities.owner
    missing = client.get(f"/api/v1/guided-missions/{uuid.uuid4()}")
    assert (missing.status_code, missing.json()["code"]) == (404, "mission_not_found")


def test_active_lookup_then_404_after_completion_and_new_mission_allowed(client, place_id):
    mission_id = _create(client, place_id).json()["missionId"]
    active = client.get("/api/v1/guided-missions/active", params={"place_id": str(place_id)})
    assert active.status_code == 200 and active.json()["missionId"] == mission_id
    camel = client.get("/api/v1/guided-missions/active", params={"placeId": str(place_id)})
    assert camel.json()["missionId"] == mission_id
    assert client.post(f"/api/v1/guided-missions/{mission_id}/complete").status_code == 200
    gone = client.get("/api/v1/guided-missions/active", params={"place_id": str(place_id)})
    assert (gone.status_code, gone.json()["code"]) == (404, "mission_not_found")
    fresh = _create(client, place_id)
    assert fresh.status_code == 201 and fresh.json()["missionId"] != mission_id


def test_plant_progress_rules(client, place_id):
    mission_id = _create(client, place_id).json()["missionId"]
    url = f"/api/v1/guided-missions/{mission_id}/plants"

    def plant(body, species):
        return next(p for p in body["plants"] if p["speciesId"] == species)

    for state in ("not_checked", "unable_to_check"):
        rejected = client.put(f"{url}/{SPECIES[0]}", json={"state": state, "noTargetFound": True})
        assert (rejected.status_code, rejected.json()["code"]) == (
            422,
            "no_find_requires_looked_for",
        )
    found = client.put(f"{url}/{SPECIES[0]}", json={"state": "looked_for", "noTargetFound": True})
    assert found.status_code == 200
    assert plant(found.json(), SPECIES[0]) | {"updatedAt": None} == {
        "speciesId": SPECIES[0],
        "state": "looked_for",
        "noTargetFound": True,
        "updatedAt": None,
    }
    # Omitting noTargetFound while staying looked_for keeps the flag.
    kept = client.put(f"{url}/{SPECIES[0]}", json={"state": "looked_for"})
    assert plant(kept.json(), SPECIES[0])["noTargetFound"] is True
    # Leaving looked_for clears it; returning does not resurrect it.
    cleared = client.put(f"{url}/{SPECIES[0]}", json={"state": "unable_to_check"})
    assert plant(cleared.json(), SPECIES[0]) | {"updatedAt": None} == {
        "speciesId": SPECIES[0],
        "state": "unable_to_check",
        "noTargetFound": False,
        "updatedAt": None,
    }
    back = client.put(f"{url}/{SPECIES[0]}", json={"state": "looked_for"})
    assert plant(back.json(), SPECIES[0])["noTargetFound"] is False
    explicit_false = client.put(
        f"{url}/{SPECIES[1]}", json={"state": "looked_for", "noTargetFound": False}
    )
    assert plant(explicit_false.json(), SPECIES[1])["noTargetFound"] is False
    assert client.put(f"{url}/{SPECIES[0]}", json={"state": "maybe"}).status_code == 422
    unknown = client.put(f"{url}/lantana-not-listed", json={"state": "looked_for"})
    assert (unknown.status_code, unknown.json()["code"]) == (404, "species_not_in_mission")

    client.post(f"/api/v1/guided-missions/{mission_id}/complete")
    locked = client.put(f"{url}/{SPECIES[0]}", json={"state": "not_checked"})
    assert (locked.status_code, locked.json()["code"]) == (409, "mission_completed")


def test_selected_species_validation(client, place_id):
    mission_id = _create(client, place_id).json()["missionId"]
    url = f"/api/v1/guided-missions/{mission_id}"
    selected = client.patch(url, json={"selectedSpeciesId": SPECIES[1]})
    assert selected.status_code == 200 and selected.json()["selectedSpeciesId"] == SPECIES[1]
    bad = client.patch(url, json={"selectedSpeciesId": "not-in-mission"})
    assert (bad.status_code, bad.json()["code"]) == (422, "species_not_in_mission")
    assert client.get(url).json()["selectedSpeciesId"] == SPECIES[1]
    cleared = client.patch(url, json={"selectedSpeciesId": None})
    assert cleared.status_code == 200 and cleared.json()["selectedSpeciesId"] is None
    assert client.patch(url, json={}).status_code == 422
    client.post(f"{url}/complete")
    locked = client.patch(url, json={"selectedSpeciesId": SPECIES[0]})
    assert (locked.status_code, locked.json()["code"]) == (409, "mission_completed")


def test_complete_is_idempotent(client, place_id):
    mission_id = _create(client, place_id).json()["missionId"]
    url = f"/api/v1/guided-missions/{mission_id}/complete"
    first = client.post(url)
    assert first.status_code == 200
    assert first.json()["status"] == "completed" and first.json()["completedAt"]
    second = client.post(url)
    assert second.status_code == 200
    # SQLite drops tz info on reload, so compare instants without the suffix.
    assert _no_tz(second.json()) == _no_tz(first.json())
    detail = client.get(f"/api/v1/guided-missions/{mission_id}").json()
    assert detail["status"] == "completed"
    assert _no_tz(detail["completedAt"]) == _no_tz(first.json()["completedAt"])


def _no_tz(value):
    if isinstance(value, dict):
        return {key: _no_tz(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_no_tz(item) for item in value]
    if isinstance(value, str) and value.endswith("Z"):
        return value[:-1]
    return value


def _add_report(session, mission_id, profile_id, species, status, created_at):
    report_id = uuid.uuid4()
    session.execute(
        insert(Report.__table__).values(
            id=report_id,
            mission_id=mission_id,
            profile_id=profile_id,
            species_id=species,
            status=status,
            created_at=created_at,
        )
    )
    return report_id


def test_summary_counts(client, identities, db, place_id):
    mission_id = _create(client, place_id).json()["missionId"]
    mission_uuid = uuid.UUID(mission_id)
    url = f"/api/v1/guided-missions/{mission_id}"
    client.put(f"{url}/plants/{SPECIES[0]}", json={"state": "looked_for", "noTargetFound": True})
    client.put(f"{url}/plants/{SPECIES[1]}", json={"state": "unable_to_check"})
    now = datetime.now(UTC)
    with db() as session:
        screened = _add_report(session, mission_uuid, identities.owner, SPECIES[2], "screened", now)
        processing = _add_report(
            session, mission_uuid, identities.owner, SPECIES[2], "processing", now + timedelta(1)
        )
        _add_report(session, mission_uuid, identities.owner, SPECIES[2], "rejected", now)
        withdrawn = _add_report(
            session, mission_uuid, identities.owner, SPECIES[2], "screened", now
        )
        sighting_id = uuid.uuid4()
        session.execute(insert(Sighting.__table__).values(id=sighting_id, status="withdrawn"))
        session.execute(
            insert(ReportSightingLink.__table__).values(
                id=uuid.uuid4(), report_id=withdrawn, sighting_id=sighting_id, active=True
            )
        )
        _add_report(session, None, identities.owner, SPECIES[2], "screened", now)
        for linked in (mission_uuid, mission_uuid, None):
            session.execute(
                insert(Scan.__table__).values(
                    id=uuid.uuid4(),
                    profile_id=identities.owner,
                    capture_id=uuid.uuid4(),
                    outcome="uncertain",
                    confidence=0.5,
                    model_version="test",
                    capture_source="gallery",
                    mission_id=linked,
                )
            )
        session.commit()

    summary = client.get(f"{url}/summary")
    assert summary.status_code == 200
    data = summary.json()
    assert set(data) == {
        "missionId",
        "placeId",
        "status",
        "startedAt",
        "completedAt",
        "lookedForCount",
        "unableToCheckCount",
        "notCheckedCount",
        "noTargetFoundCount",
        "scansCount",
        "reportsSubmittedCount",
        "reports",
    }
    assert (
        data["lookedForCount"],
        data["unableToCheckCount"],
        data["notCheckedCount"],
        data["noTargetFoundCount"],
    ) == (1, 1, 1, 1)
    assert data["scansCount"] == 2
    assert data["reportsSubmittedCount"] == 2
    assert [r["reportId"] for r in data["reports"]] == [str(screened), str(processing)]
    assert set(data["reports"][0]) == {"reportId", "speciesId", "status", "submittedAt"}
    detail = client.get(url).json()
    assert detail["scansCount"] == 2 and len(detail["reports"]) == 2
    completed = client.post(f"{url}/complete").json()
    assert completed | {"status": None, "completedAt": None} == data | {
        "status": None,
        "completedAt": None,
    }


def test_no_find_stays_separate_from_submitted_sightings(client, identities, db, place_id):
    mission_id = _create(client, place_id).json()["missionId"]
    url = f"/api/v1/guided-missions/{mission_id}"
    # Recorded first, then a sighting of the same plant arrives: the no-find
    # outcome no longer counts, so the two are never double counted.
    client.put(f"{url}/plants/{SPECIES[0]}", json={"state": "looked_for", "noTargetFound": True})
    with db() as session:
        _add_report(
            session,
            uuid.UUID(mission_id),
            identities.owner,
            SPECIES[0],
            "processing",
            datetime.now(UTC),
        )
        session.commit()
    summary = client.get(f"{url}/summary").json()
    assert (summary["noTargetFoundCount"], summary["reportsSubmittedCount"]) == (0, 1)
    # Once a sighting exists, no-find cannot be recorded for that plant.
    client.put(f"{url}/plants/{SPECIES[0]}", json={"state": "looked_for", "noTargetFound": False})
    rejected = client.put(
        f"{url}/plants/{SPECIES[0]}", json={"state": "looked_for", "noTargetFound": True}
    )
    assert rejected.status_code == 409
    assert rejected.json()["code"] == "sighting_already_submitted"


def test_database_enforces_one_active_mission_and_no_find_rule(db, place_id):
    profile = uuid.uuid4()
    with db() as session:
        session.add(GuidedMission(profile_id=profile, place_id=place_id, dataset_version="v1"))
        session.commit()
        session.add(GuidedMission(profile_id=profile, place_id=place_id, dataset_version="v1"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        mission = session.scalar(select(GuidedMission))
        session.add(
            GuidedMissionPlantProgress(
                mission_id=mission.id,
                species_id=SPECIES[0],
                state="unable_to_check",
                no_target_found=True,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_validate_mission_link_requires_active_owned_mission(db, place_id):
    owner, other = uuid.uuid4(), uuid.uuid4()
    with db() as session:
        active = GuidedMission(profile_id=owner, place_id=place_id, dataset_version="v1")
        done = GuidedMission(
            profile_id=owner,
            place_id=uuid.uuid4(),
            dataset_version="v1",
            status="completed",
            completed_at=datetime.now(UTC),
        )
        session.add_all((active, done))
        session.commit()
        assert validate_mission_link(session, active.id, owner).id == active.id
        for mission_id, profile in ((active.id, other), (done.id, owner), (uuid.uuid4(), owner)):
            with pytest.raises(ApiProblem) as caught:
                validate_mission_link(session, mission_id, profile)
            assert (caught.value.status_code, caught.value.code) == (422, "mission_invalid")


def _report_payload(**extra):
    return dict(
        photoKey="uploads/example.jpg",
        speciesId="mikania-micrantha",
        outcome="target",
        confidence=0.9,
        modelVersion="test-model",
        observedAt=datetime.now(UTC).isoformat(),
        captureId=str(uuid.uuid4()),
        captureSource="gallery",
        location={"lat": 3.005, "lng": 101.005},
        locationAccuracyM=10,
        extent="single",
        notes="",
        consent={"accurate": True, "noPII": True},
        **extra,
    )


def test_report_and_scan_schemas_accept_mission_id_additively():
    mission_id = uuid.uuid4()
    ordinary = ReportSubmission.model_validate(_report_payload())
    assert "missionId" not in ordinary.model_dump(mode="json", by_alias=True)
    camel = ReportSubmission.model_validate(_report_payload(missionId=str(mission_id)))
    snake = ReportSubmission.model_validate(_report_payload(mission_id=str(mission_id)))
    assert camel.mission_id == snake.mission_id == mission_id
    both = ReportSubmission.model_validate(
        _report_payload(
            missionId=str(mission_id),
            eventId=str(uuid.uuid4()),
            capturedAt=datetime.now(UTC).isoformat(),
        )
    )
    wire = both.model_dump(mode="json", by_alias=True)
    assert wire["missionId"] == str(mission_id) and wire["eventId"]
    with pytest.raises(ValidationError):
        ReportSubmission.model_validate(_report_payload(missionId="not-a-uuid"))

    response = {
        "id": str(uuid.uuid4()),
        "status": "processing",
        "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "submission": _report_payload(),
        "trackingUrl": "/reports/x",
        "validation": {"reasonCodes": [], "retryable": False, "policyVersion": None},
        "sightingId": None,
    }
    assert "missionId" not in ReportResponse.model_validate(response).model_dump(by_alias=True)
    linked = ReportResponse.model_validate({**response, "missionId": str(mission_id)}).model_dump(
        mode="json", by_alias=True
    )
    assert linked["missionId"] == str(mission_id) and "eventId" not in linked

    scan = ScanCreateRequest.model_validate(
        {
            "captureId": str(uuid.uuid4()),
            "outcome": "uncertain",
            "confidence": 0.4,
            "modelVersion": "m",
            "captureSource": "gallery",
            "missionId": str(mission_id),
        }
    )
    assert scan.mission_id == mission_id and scan.capture_source == "gallery"


def test_report_with_foreign_mission_is_rejected_before_any_write(monkeypatch):
    profile_id = uuid.uuid4()
    foreign = SimpleNamespace(id=uuid.uuid4(), profile_id=uuid.uuid4(), status="active")
    grant = SimpleNamespace(consumed_at=None)
    session = MagicMock()
    # idempotency record lookup, upload grant lookup, mission lookup
    session.scalar.side_effect = [None, grant, foreign]
    monkeypatch.setattr(reports.rate_limiter, "check", lambda *_a, **_k: None)
    monkeypatch.setattr(
        reports.storage, "head", MagicMock(side_effect=AssertionError("storage touched"))
    )
    body = ReportSubmission.model_validate(_report_payload(missionId=str(foreign.id)))
    with pytest.raises(ApiProblem) as caught:
        reports.create_report(
            body=body,
            request=MagicMock(),
            response=MagicMock(),
            idempotency_key="mission-test-key-0001",
            queued_retry=False,
            client_catalogue_version=None,
            client_catalogue_sha256=None,
            auth=SimpleNamespace(profile=SimpleNamespace(id=profile_id, trust_level="New")),
            session=session,
        )
    assert (caught.value.status_code, caught.value.code) == (422, "mission_invalid")
    session.add.assert_not_called()
    session.commit.assert_not_called()
    assert grant.consumed_at is None


def test_scan_with_mission_links_and_keeps_gallery_source(client, identities, db, place_id):
    mission_id = _create(client, place_id).json()["missionId"]

    def scan_body(**extra):
        return {
            "captureId": str(uuid.uuid4()),
            "outcome": "uncertain",
            "confidence": 0.4,
            "modelVersion": "m",
            "captureSource": "gallery",
            **extra,
        }

    linked = client.post("/api/v1/scans", json=scan_body(missionId=mission_id))
    assert linked.status_code == 201, linked.text
    assert linked.json()["missionId"] == mission_id
    assert linked.json()["captureSource"] == "gallery"
    plain = client.post("/api/v1/scans", json=scan_body())
    assert plain.status_code == 201 and "missionId" not in plain.json()
    assert client.get(f"/api/v1/guided-missions/{mission_id}").json()["scansCount"] == 1

    identities.current["profile"] = identities.other
    foreign = client.post("/api/v1/scans", json=scan_body(missionId=mission_id))
    assert (foreign.status_code, foreign.json()["code"]) == (422, "mission_invalid")
    with db() as session:
        assert session.scalar(select(Scan.id).where(Scan.profile_id == identities.other)) is None
    assert scans.validate_mission_link is validate_mission_link
