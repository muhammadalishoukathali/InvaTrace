"""The API keeps its own Render free-tier instance awake by pinging its public
URL; these pin down when that loop is (and is not) started."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.main import _self_keepalive_target


def _settings(enabled: bool, url: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(self_keepalive_enabled=enabled, self_keepalive_url=url)


def test_disabled_by_default_even_on_render(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://invatrace-api-lmzr.onrender.com")
    assert _self_keepalive_target(_settings(enabled=False)) is None


def test_uses_render_external_url_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://invatrace-api-lmzr.onrender.com/")
    assert (
        _self_keepalive_target(_settings(enabled=True))
        == "https://invatrace-api-lmzr.onrender.com/health/live"
    )


def test_explicit_url_wins_over_render_external_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://invatrace-api-lmzr.onrender.com")
    assert (
        _self_keepalive_target(_settings(enabled=True, url="https://api.example.org"))
        == "https://api.example.org/health/live"
    )


def test_no_public_url_means_no_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    assert _self_keepalive_target(_settings(enabled=True)) is None
