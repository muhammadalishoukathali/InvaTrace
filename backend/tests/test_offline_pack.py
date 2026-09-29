"""Contract tests for the versioned, read-only offline catalogue pack."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.api.routers.offline_pack import latest_offline_pack, offline_pack_file
from app.core.errors import ApiProblem


def _request() -> SimpleNamespace:
    """Stub the parts of starlette.Request that rate_limit.client_address touches."""
    return SimpleNamespace(client=SimpleNamespace(host="test"))


def test_latest_manifest_and_every_declared_pack_file_are_served() -> None:
    manifest_response = latest_offline_pack(_request())
    manifest = json.loads(manifest_response.body)

    assert manifest_response.headers["cache-control"] == "no-store"
    assert manifest["catalogue_version"]
    assert set(manifest["files"])

    for file_name in manifest["files"]:
        response = offline_pack_file(_request(), manifest["catalogue_version"], file_name)
        assert response.media_type == "application/json"
        assert response.headers["cache-control"] == "no-store"
        assert json.loads(response.body)


def test_pack_endpoint_rejects_unknown_version() -> None:
    with pytest.raises(ApiProblem) as caught:
        offline_pack_file(_request(), "not-the-current-version", "approved-species.json")

    assert caught.value.status_code == 404
    assert caught.value.code == "offline_pack_version_not_found"


@pytest.mark.parametrize("file_name", ["../approved-species.json", "unreviewed.json"])
def test_pack_endpoint_rejects_unknown_files(file_name: str) -> None:
    manifest = json.loads(latest_offline_pack(_request()).body)

    with pytest.raises(ApiProblem) as caught:
        offline_pack_file(_request(), manifest["catalogue_version"], file_name)

    assert caught.value.status_code == 404
    assert caught.value.code == "offline_pack_file_not_found"
