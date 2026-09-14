"""AC Phase 5 - reference data / demo data separation.

Full idempotency is verified by the docker-compose integration harness that
runs the loader twice against a real Postgres. These unit-level checks
guard the interface contract so the CLI, render.yaml pre-deploy command,
and any downstream tooling can rely on the two functions existing with
their documented behaviour.
"""

from __future__ import annotations

import pytest

from app import cli, seed


def test_load_and_seed_are_separately_callable() -> None:
    assert callable(seed.load_reference_data)
    assert callable(seed.load_development_fixtures)
    assert callable(seed.seed_demo_data)
    # Back-compat wrapper still exposed for existing callers.
    assert callable(seed.seed_development_data)


def test_species_catalogue_is_the_closed_32_species_allowlist() -> None:
    ids = {entry["id"] for entry in seed.SPECIES}
    # The full 31 come from the model catalogue merger; explicitly seeded
    # rows include the four hand-written ones plus one legacy id retained
    # for cleanup logic - so the seed always exceeds 30 entries after
    # _apply_model_catalog_to_species_seed() runs at import time.
    assert len(ids) == 32
    assert "ageratina-adenophora" not in ids
    assert "lantana-camara" not in ids


def test_reference_loader_inserts_no_development_places_or_sightings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class ReferenceOnlySession:
        def __init__(self) -> None:
            self.added: list[object] = []

        def get(self, _model, _key):
            return None

        def add(self, value: object) -> None:
            self.added.append(value)

        def flush(self) -> None:
            pass

        def commit(self) -> None:
            pass

    monkeypatch.setattr(seed, "SPECIES", [])
    monkeypatch.setattr(seed, "LEGACY_SEED_SPECIES_IDS", set())
    session = ReferenceOnlySession()
    seed.load_reference_data(session)
    assert session.added == []


def test_demo_seed_never_runs_in_production_via_cli(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[str] = []
    monkeypatch.setattr(cli, "SessionLocal", lambda: _RecordingSession(called))
    monkeypatch.setattr(cli, "seed_demo_data", lambda session: called.append("demo"))
    monkeypatch.setattr(cli, "load_development_fixtures", lambda session: called.append("fixtures"))
    monkeypatch.setattr(cli, "load_reference_data", lambda session: called.append("ref"))
    monkeypatch.setattr(cli, "seed_development_data", lambda session: called.append("legacy"))

    class Settings:
        app_env = "production"

    monkeypatch.setattr(cli, "get_settings", lambda: Settings)

    monkeypatch.setattr("sys.argv", ["invatrace", "seed"])
    with pytest.raises(SystemExit) as excinfo:
        cli.main()
    assert "development-only" in str(excinfo.value)

    monkeypatch.setattr("sys.argv", ["invatrace", "seed-demo-data"])
    with pytest.raises(SystemExit) as excinfo:
        cli.main()
    assert "production" in str(excinfo.value)

    monkeypatch.setattr("sys.argv", ["invatrace", "load-development-fixtures"])
    with pytest.raises(SystemExit) as excinfo:
        cli.main()
    assert "production" in str(excinfo.value)

    assert called == []  # neither refused command reached the actual loaders


def test_reference_loader_runs_in_production_via_cli(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[str] = []
    monkeypatch.setattr(cli, "SessionLocal", lambda: _RecordingSession(called))
    monkeypatch.setattr(cli, "load_reference_data", lambda session: called.append("ref"))
    monkeypatch.setattr(cli, "seed_demo_data", lambda session: called.append("demo"))
    monkeypatch.setattr(cli, "load_development_fixtures", lambda session: called.append("fixtures"))
    monkeypatch.setattr(cli, "seed_development_data", lambda session: called.append("legacy"))

    class Settings:
        app_env = "production"

    monkeypatch.setattr(cli, "get_settings", lambda: Settings)
    monkeypatch.setattr("sys.argv", ["invatrace", "load-reference-data"])
    cli.main()
    assert called == ["ref"]


class _RecordingSession:
    """Context-manager stand-in for a SQLAlchemy session that just records
    which loader the CLI hands it to, without touching a real database."""

    def __init__(self, sink: list[str]) -> None:
        self.sink = sink

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> bool:
        return False
